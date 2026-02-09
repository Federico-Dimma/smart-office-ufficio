import json
import boto3
import uuid
import re
import urllib.request
import urllib.error
from decimal import Decimal
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb', region_name='eu-south-1')
table = dynamodb.Table('smart-office-schedules')

OFFICE_API_BASE = 'http://5.89.101.247:8086'

# Mappatura ID termostato -> indirizzo hardware
THERMO_ADDRESSES = {
    0: 151,  # Martina
    1: 157,  # Federico
    2: 153,  # Michele
    3: 152,  # Franco
    4: 158,  # Corridoio
    5: 155,  # Commerciale
    6: 154,  # Ingresso
    7: 159,  # Federica
}

# Helper per convertire Decimal in int/float per JSON
class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super(DecimalEncoder, self).default(obj)

def json_response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        'body': json.dumps(body, cls=DecimalEncoder)
    }

def lambda_handler(event, context):
    print(f"Event: {json.dumps(event)}")
    
    http_method = event.get('httpMethod', event.get('requestContext', {}).get('http', {}).get('method', 'GET'))
    
    # HTTP API 2.0 usa rawPath che include lo stage (/prod/xxx), lo rimuoviamo
    raw_path = event.get('rawPath', event.get('path', '/'))
    # Rimuovi prefisso stage se presente
    if raw_path.startswith('/prod/'):
        path = raw_path[5:]  # Rimuove '/prod'
    elif raw_path.startswith('/prod'):
        path = raw_path[5:] or '/'
    else:
        path = raw_path
    
    print(f"Method: {http_method}, Path: {path}")
    
    # Handle CORS preflight
    if http_method == 'OPTIONS':
        return json_response(200, {'message': 'OK'})
    
    try:
        if path == '/schedules' and http_method == 'GET':
            return get_all_schedules()
        elif path == '/schedules' and http_method == 'POST':
            body = json.loads(event.get('body', '{}'))
            return add_schedule(body)
        elif path == '/schedules' and http_method == 'DELETE':
            params = event.get('queryStringParameters', {}) or {}
            return delete_schedule(params.get('thermoId'), params.get('scheduleId'))
        elif path == '/schedules/toggle' and http_method == 'POST':
            body = json.loads(event.get('body', '{}'))
            return toggle_schedule(body.get('thermoId'), body.get('scheduleId'), body.get('active'))
        elif path == '/thermostat' and http_method == 'POST':
            body = json.loads(event.get('body', '{}'))
            return set_thermostat(body.get('id'), body.get('speed'))
        elif path == '/status' and http_method == 'GET':
            return get_thermostat_status()
        else:
            return json_response(404, {'error': 'Not found'})
    except Exception as e:
        print(f"Error: {str(e)}")
        return json_response(500, {'error': str(e)})

def get_all_schedules():
    """Recupera tutte le schedule raggruppate per termostato"""
    result = {}
    
    # Scan della tabella (piccola, ok per scan)
    response = table.scan()
    items = response.get('Items', [])
    
    for item in items:
        thermo_id = item['pk'].replace('THERMO#', '')
        if thermo_id not in result:
            result[thermo_id] = []
        result[thermo_id].append({
            'id': item['sk'].replace('SCHEDULE#', ''),
            'days': item.get('days', [False]*7),
            'hour': item.get('hour', 0),
            'minute': item.get('minute', 0),
            'speed': item.get('speed', 0),
            'active': item.get('active', True),
            'oneTime': item.get('oneTime', False)
        })
    
    # Assicura che tutti i termostati (0-7) siano presenti
    for i in range(8):
        if str(i) not in result:
            result[str(i)] = []
    
    return json_response(200, {'schedules': result})

def add_schedule(body):
    """Aggiunge una nuova schedule"""
    thermo_id = str(body.get('thermoId', 0))
    schedule_id = str(uuid.uuid4())[:8]
    
    item = {
        'pk': f'THERMO#{thermo_id}',
        'sk': f'SCHEDULE#{schedule_id}',
        'days': body.get('days', [False]*7),
        'hour': int(body.get('hour', 0)),
        'minute': int(body.get('minute', 0)),
        'speed': int(body.get('speed', 0)),
        'active': True,
        'oneTime': bool(body.get('oneTime', False))
    }
    
    table.put_item(Item=item)
    
    return json_response(200, {
        'success': True,
        'scheduleId': schedule_id
    })

def delete_schedule(thermo_id, schedule_id):
    """Elimina una schedule"""
    if not thermo_id or not schedule_id:
        return json_response(400, {'error': 'Missing thermoId or scheduleId'})
    
    table.delete_item(
        Key={
            'pk': f'THERMO#{thermo_id}',
            'sk': f'SCHEDULE#{schedule_id}'
        }
    )
    
    return json_response(200, {'success': True})

def toggle_schedule(thermo_id, schedule_id, active):
    """Attiva/disattiva una schedule"""
    if thermo_id is None or not schedule_id:
        return json_response(400, {'error': 'Missing thermoId or scheduleId'})
    
    table.update_item(
        Key={
            'pk': f'THERMO#{thermo_id}',
            'sk': f'SCHEDULE#{schedule_id}'
        },
        UpdateExpression='SET active = :active',
        ExpressionAttributeValues={':active': bool(active)}
    )
    
    return json_response(200, {'success': True, 'active': bool(active)})

def set_thermostat(thermo_id, speed):
    """Invia comando al server ufficio (proxy per evitare mixed content)"""
    if thermo_id is None or speed is None:
        return json_response(400, {'error': 'Missing id or speed'})
    
    thermo_id = int(thermo_id)
    speed = int(speed)
    
    # Ottieni indirizzo hardware
    if thermo_id not in THERMO_ADDRESSES:
        return json_response(400, {'error': f'Invalid thermostat id: {thermo_id}'})
    
    address = THERMO_ADDRESSES[thermo_id]
    
    try:
        url = f'{OFFICE_API_BASE}/cgi-bin/imposta?velocita={speed}&seriale=ttyS1&indirizzo={address}&posizione=1&attuatore=V&fascia=inverno'
        print(f"Calling office API: {url}")
        
        req = urllib.request.Request(url, method='GET')
        req.add_header('User-Agent', 'SmartOffice-Lambda/1.0')
        
        with urllib.request.urlopen(req, timeout=10) as response:
            status = response.status
            print(f"Office API response: HTTP {status}")
            return json_response(200, {'success': True, 'status': status})
    except urllib.error.HTTPError as e:
        # Anche 200 con header malformato può essere ok
        print(f"Office API HTTPError: {e.code}")
        if e.code == 200:
            return json_response(200, {'success': True})
        return json_response(502, {'error': f'Office server error: HTTP {e.code}'})
    except urllib.error.URLError as e:
        print(f"Office API error: {str(e)}")
        return json_response(502, {'error': f'Office server error: {str(e)}'})
    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        # Il server risponde ma con header non standard, il comando passa comunque
        if 'header' in str(e).lower():
            return json_response(200, {'success': True, 'note': 'Command sent'})
        return json_response(500, {'error': str(e)})

def get_thermostat_status():
    """Legge lo stato attuale di tutti i termostati dalla pagina mappa.cgi"""
    try:
        url = f'{OFFICE_API_BASE}/cgi-bin/mappa.cgi?id=2'
        print(f"Fetching status from: {url}")
        
        req = urllib.request.Request(url, method='GET')
        req.add_header('User-Agent', 'SmartOffice-Lambda/1.0')
        
        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read().decode('latin-1')
        
        # Mappa inversa: indirizzo -> id termostato
        address_to_id = {v: k for k, v in THERMO_ADDRESSES.items()}
        thermo_names = ['Martina', 'Federico', 'Michele', 'Franco', 'Corridoio', 'Commerciale', 'Ingresso', 'Federica']
        
        status = {}
        
        # Cerca pattern: checked="checked" per ogni velocità di ogni termostato
        # Pattern: speed_ttyS1_{indirizzo}_1_{velocità}" value="{velocità}" checked="checked"
        for address, thermo_id in address_to_id.items():
            # Cerca quale radio button è checked per questo indirizzo
            pattern = rf'speed_ttyS1_{address}_1_(\d)"\s+value="\d"\s*checked="checked"'
            match = re.search(pattern, html)
            
            if match:
                speed = int(match.group(1))
            else:
                # Prova pattern alternativo (checked prima di value)
                pattern2 = rf'speed_ttyS1_{address}_1_(\d)"[^>]*checked="checked"'
                match2 = re.search(pattern2, html)
                if match2:
                    speed = int(match2.group(1))
                else:
                    speed = -1  # Sconosciuto
            
            status[thermo_id] = {
                'name': thermo_names[thermo_id] if thermo_id < len(thermo_names) else f'Thermo {thermo_id}',
                'speed': speed,
                'address': address
            }
        
        print(f"Status result: {status}")
        return json_response(200, {'status': status})
        
    except Exception as e:
        print(f"Error fetching status: {str(e)}")
        return json_response(502, {'error': f'Failed to fetch status: {str(e)}'})

