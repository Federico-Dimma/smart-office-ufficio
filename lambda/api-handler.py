import json
import boto3
import uuid
import urllib.request
import urllib.error
from decimal import Decimal
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb', region_name='eu-south-1')
table = dynamodb.Table('smart-office-schedules')

OFFICE_API_BASE = 'http://5.89.101.247:8086'

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
            'active': item.get('active', True)
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
        'active': True
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
    
    try:
        url = f'{OFFICE_API_BASE}/set?id={thermo_id}&speed={speed}'
        print(f"Calling office API: {url}")
        
        req = urllib.request.Request(url, method='GET')
        req.add_header('User-Agent', 'SmartOffice-Lambda/1.0')
        
        with urllib.request.urlopen(req, timeout=10) as response:
            result = response.read().decode('utf-8')
            print(f"Office API response: {result}")
            return json_response(200, {'success': True, 'response': result})
    except urllib.error.URLError as e:
        print(f"Office API error: {str(e)}")
        return json_response(502, {'error': f'Office server error: {str(e)}'})
    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        return json_response(500, {'error': str(e)})
