import json
import boto3
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

dynamodb = boto3.resource('dynamodb', region_name='eu-south-1')
table = dynamodb.Table('smart-office-schedules')

# Configurazione
OFFICE_API_BASE = 'http://5.89.101.247:8086'
# Timezone Italia: UTC+1 (inverno) o UTC+2 (estate)
# Usiamo un offset semplificato, si puo' migliorare con DST check
ITALY_OFFSET = timedelta(hours=1)  # CET

# Nomi termostati per logging
THERMO_NAMES = ['Martina', 'Federico', 'Michele', 'Franco', 'Corridoio', 'Commerciale', 'Ingresso', 'Federica']

def is_dst():
    """Verifica se siamo in ora legale (approssimativa)"""
    now_utc = datetime.now(timezone.utc)
    # Ora legale in Italia: ultima domenica marzo - ultima domenica ottobre
    year = now_utc.year
    # Ultima domenica di marzo
    march_last = datetime(year, 3, 31, tzinfo=timezone.utc)
    while march_last.weekday() != 6:  # 6 = Sunday
        march_last -= timedelta(days=1)
    # Ultima domenica di ottobre
    oct_last = datetime(year, 10, 31, tzinfo=timezone.utc)
    while oct_last.weekday() != 6:
        oct_last -= timedelta(days=1)
    
    return march_last <= now_utc < oct_last

def lambda_handler(event, context):
    """
    Scheduler Lambda - Eseguita ogni minuto da EventBridge.
    Controlla le schedule attive e invia comandi ai termostati.
    """
    # Ottieni ora locale italiana
    offset = timedelta(hours=2) if is_dst() else timedelta(hours=1)
    italy_tz = timezone(offset)
    now = datetime.now(italy_tz)
    
    # Giorno della settimana: 0=Dom, 1=Lun, ..., 6=Sab
    # Python weekday(): 0=Mon, 1=Tue, ..., 6=Sun
    # Convertiamo: Python 0=Mon -> 1, Python 6=Sun -> 0
    python_weekday = now.weekday()
    current_day = (python_weekday + 1) % 7  # 0=Dom, 1=Lun, ...
    
    current_hour = now.hour
    current_minute = now.minute
    
    print(f"[SCHEDULER] Controllo alle {now.strftime('%H:%M:%S')} - Giorno: {current_day}")
    
    # Recupera tutte le schedule
    response = table.scan()
    items = response.get('Items', [])
    
    executed = []
    
    for item in items:
        # Verifica se attiva
        if not item.get('active', True):
            continue
        
        # Verifica giorno
        days = item.get('days', [])
        if len(days) <= current_day or not days[current_day]:
            continue
        
        # Verifica ora e minuto
        sched_hour = int(item.get('hour', -1))
        sched_minute = int(item.get('minute', -1))
        
        if sched_hour == current_hour and sched_minute == current_minute:
            # Estrai info
            thermo_id = item['pk'].replace('THERMO#', '')
            speed = int(item.get('speed', 0))
            thermo_name = THERMO_NAMES[int(thermo_id)] if int(thermo_id) < len(THERMO_NAMES) else f'Thermo {thermo_id}'
            
            print(f"[SCHEDULER] Esecuzione: {thermo_name} -> Velocita {speed}")
            
            # Invia comando
            try:
                url = f"{OFFICE_API_BASE}/set?id={thermo_id}&speed={speed}"
                req = urllib.request.Request(url, method='GET')
                req.add_header('User-Agent', 'SmartOffice-Scheduler/1.0')
                
                with urllib.request.urlopen(req, timeout=10) as resp:
                    status = resp.status
                    print(f"[SCHEDULER] Risposta {thermo_name}: HTTP {status}")
                    executed.append({
                        'thermo': thermo_name,
                        'speed': speed,
                        'status': 'OK'
                    })
            except urllib.error.URLError as e:
                print(f"[SCHEDULER] ERRORE {thermo_name}: {str(e)}")
                executed.append({
                    'thermo': thermo_name,
                    'speed': speed,
                    'status': f'ERROR: {str(e)}'
                })
            except Exception as e:
                print(f"[SCHEDULER] ERRORE {thermo_name}: {str(e)}")
                executed.append({
                    'thermo': thermo_name,
                    'speed': speed,
                    'status': f'ERROR: {str(e)}'
                })
    
    result = {
        'timestamp': now.isoformat(),
        'executed': len(executed),
        'details': executed
    }
    
    print(f"[SCHEDULER] Completato: {json.dumps(result)}")
    
    return result
