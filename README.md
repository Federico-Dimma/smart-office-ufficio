# 🏢 Smart Office - Controllo Termostati

Applicazione web per il controllo remoto dei termostati dell'ufficio.

## Funzionalità

- ✅ Controllo manuale velocità termostati (OFF, V1, V2, V3)
- ✅ Programmazione automatica orari
- ✅ Gestione 8 termostati ufficio
- ✅ Interfaccia responsive
- ✅ Notifiche real-time

## Termostati Configurati

| Nome | Indirizzo |
|------|----------|
| Martina | 151 |
| Federico | 157 |
| Michele | 153 |
| Franco | 152 |
| Corridoio | 158 |
| Commerciale | 155 |
| Ingresso | 154 |
| Federica | 159 |

## Deployment

Hostato su AWS Amplify: `ufficio.dimmaweb.com`

## Comandi

```bash
# Installazione
npm install

# Development
npm run dev

# Build
npm run build
```

## Architettura

- Frontend: React + Vite
- Hosting: AWS Amplify (eu-south-1 - Milano)
- Backend: Server ufficio (IP esterno: 5.89.101.247:8086)
