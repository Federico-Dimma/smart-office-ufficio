import { useState, useEffect, useCallback } from 'react'
import './App.css'

// Configurazione - IP esterno dell'ufficio
const OFFICE_API_BASE = 'http://5.89.101.247:8086'

// Lista termostati (uguale all'ESP32)
const THERMOSTATS = [
  { id: 0, name: 'Martina', serial: 'ttyS1', address: 151, position: 1 },
  { id: 1, name: 'Federico', serial: 'ttyS1', address: 157, position: 1 },
  { id: 2, name: 'Michele', serial: 'ttyS1', address: 153, position: 1 },
  { id: 3, name: 'Franco', serial: 'ttyS1', address: 152, position: 1 },
  { id: 4, name: 'Corridoio', serial: 'ttyS1', address: 158, position: 1 },
  { id: 5, name: 'Commerciale', serial: 'ttyS1', address: 155, position: 1 },
  { id: 6, name: 'Ingresso', serial: 'ttyS1', address: 154, position: 1 },
  { id: 7, name: 'Federica', serial: 'ttyS1', address: 159, position: 1 },
]

const DAYS_NAMES = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
const SPEED_LABELS = { 0: 'OFF', 1: 'V1', 2: 'V2', 3: 'V3' }
const SPEED_COLORS = { 0: '#dc3545', 1: '#28a745', 2: '#ffc107', 3: '#17a2b8' }

function App() {
  const [currentTime, setCurrentTime] = useState(new Date())
  const [schedules, setSchedules] = useState({})
  const [selectedThermo, setSelectedThermo] = useState(null)
  const [showAllSchedules, setShowAllSchedules] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notification, setNotification] = useState(null)
  const [newSchedule, setNewSchedule] = useState({
    days: [],
    hour: '',
    minute: '',
    speed: 0
  })

  // Aggiorna l'orologio ogni secondo
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Carica le schedule all'avvio
  useEffect(() => {
    loadAllSchedules()
  }, [])

  // Mostra notifica
  const showNotification = useCallback((message, type = 'success') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 3000)
  }, [])

  // Carica tutte le schedule dal server
  const loadAllSchedules = async () => {
    try {
      const response = await fetch(`${OFFICE_API_BASE}/getAllSchedules`)
      if (response.ok) {
        const data = await response.json()
        const schedulesMap = {}
        data.thermostats.forEach((thermo, index) => {
          schedulesMap[index] = thermo.schedules || []
        })
        setSchedules(schedulesMap)
      }
    } catch (error) {
      console.error('Errore caricamento schedule:', error)
      // Se non riesce a caricare, usa schedule vuote
      const emptySchedules = {}
      THERMOSTATS.forEach((_, index) => {
        emptySchedules[index] = []
      })
      setSchedules(emptySchedules)
    }
  }

  // Imposta velocità termostato
  const setThermostat = async (id, speed) => {
    setLoading(true)
    try {
      const response = await fetch(`${OFFICE_API_BASE}/set?id=${id}&speed=${speed}`)
      if (response.ok) {
        showNotification(`${THERMOSTATS[id].name} impostato a ${SPEED_LABELS[speed]}`, 'success')
      } else {
        throw new Error('Errore risposta server')
      }
    } catch (error) {
      console.error('Errore impostazione termostato:', error)
      showNotification(`Errore: impossibile impostare ${THERMOSTATS[id].name}`, 'error')
    }
    setLoading(false)
  }

  // Aggiungi nuova schedule
  const addSchedule = async () => {
    if (newSchedule.days.length === 0) {
      showNotification('Seleziona almeno un giorno', 'error')
      return
    }
    if (newSchedule.hour === '' || newSchedule.minute === '') {
      showNotification('Inserisci ora e minuti', 'error')
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`${OFFICE_API_BASE}/addSchedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `id=${selectedThermo}&days=${newSchedule.days.join(',')}&hour=${newSchedule.hour}&minute=${newSchedule.minute}&speed=${newSchedule.speed}`
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Programmazione aggiunta', 'success')
          await loadAllSchedules()
          setNewSchedule({ days: [], hour: '', minute: '', speed: 0 })
        } else {
          throw new Error(data.error || 'Errore sconosciuto')
        }
      } else {
        throw new Error('Errore risposta server')
      }
    } catch (error) {
      console.error('Errore aggiunta schedule:', error)
      showNotification('Errore nell\'aggiunta della programmazione', 'error')
    }
    setLoading(false)
  }

  // Elimina schedule
  const deleteSchedule = async (thermoId, scheduleIndex) => {
    if (!confirm('Eliminare questa programmazione?')) return

    setLoading(true)
    try {
      const response = await fetch(`${OFFICE_API_BASE}/deleteSchedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `thermoId=${thermoId}&scheduleIndex=${scheduleIndex}`
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Programmazione eliminata', 'success')
          await loadAllSchedules()
        }
      }
    } catch (error) {
      console.error('Errore eliminazione schedule:', error)
      showNotification('Errore nell\'eliminazione', 'error')
    }
    setLoading(false)
  }

  // Toggle giorno nella nuova schedule
  const toggleDay = (dayIndex) => {
    setNewSchedule(prev => ({
      ...prev,
      days: prev.days.includes(dayIndex)
        ? prev.days.filter(d => d !== dayIndex)
        : [...prev.days, dayIndex]
    }))
  }

  // Formatta orario
  const formatTime = (hour, minute) => {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  // Formatta giorni attivi
  const formatDays = (days) => {
    return days
      .map((active, idx) => active ? DAYS_NAMES[idx] : null)
      .filter(Boolean)
      .join(', ')
  }

  // Toggle attivazione schedule
  const toggleScheduleActive = async (thermoId, scheduleIndex, currentActive) => {
    setLoading(true)
    try {
      const response = await fetch(`${OFFICE_API_BASE}/toggleSchedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `thermoId=${thermoId}&scheduleIndex=${scheduleIndex}&active=${!currentActive}`
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification(currentActive ? 'Programmazione disattivata' : 'Programmazione attivata', 'success')
          await loadAllSchedules()
        }
      }
    } catch (error) {
      console.error('Errore toggle schedule:', error)
      showNotification('Errore nel cambio stato', 'error')
    }
    setLoading(false)
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <h1>Controllo Termostati Ufficio</h1>
          <div className="clock">
            {currentTime.toLocaleDateString('it-IT', {
              weekday: 'long',
              day: '2-digit',
              month: 'long',
              year: 'numeric'
            })}
            <span className="time">
              {currentTime.toLocaleTimeString('it-IT')}
            </span>
          </div>
          <button 
            className="btn btn-secondary"
            onClick={() => setShowAllSchedules(true)}
          >
            Tutte le Programmazioni
          </button>
        </div>
      </header>

      {/* Notifica */}
      {notification && (
        <div className={`notification ${notification.type}`}>
          {notification.message}
        </div>
      )}

      {/* Loading overlay */}
      {loading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
        </div>
      )}

      {/* Grid termostati */}
      <main className="main">
        <div className="thermostat-grid">
          {THERMOSTATS.map(thermo => (
            <div key={thermo.id} className="thermostat-card">
              <h2 className="thermostat-name">{thermo.name}</h2>
              
              <div className="speed-buttons">
                {[0, 1, 2, 3].map(speed => (
                  <button
                    key={speed}
                    className="speed-btn"
                    style={{ backgroundColor: SPEED_COLORS[speed] }}
                    onClick={() => setThermostat(thermo.id, speed)}
                    disabled={loading}
                  >
                    {SPEED_LABELS[speed]}
                  </button>
                ))}
              </div>

              <button 
                className="btn btn-schedule"
                onClick={() => setSelectedThermo(thermo.id)}
              >
                Programmazione
              </button>

              {/* Mini lista schedule */}
              {schedules[thermo.id]?.length > 0 && (
                <div className="schedule-preview">
                  {schedules[thermo.id].slice(0, 2).map((sched, idx) => (
                    <div key={idx} className="schedule-mini">
                      <span className="schedule-time">{formatTime(sched.hour, sched.minute)}</span>
                      <span className="schedule-speed" style={{ color: SPEED_COLORS[sched.speed] }}>
                        {SPEED_LABELS[sched.speed]}
                      </span>
                    </div>
                  ))}
                  {schedules[thermo.id].length > 2 && (
                    <div className="schedule-more">+{schedules[thermo.id].length - 2} altre</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>

      {/* Modal programmazione singola */}
      {selectedThermo !== null && (
        <div className="modal-overlay" onClick={() => setSelectedThermo(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Programmazione {THERMOSTATS[selectedThermo].name}</h2>
              <button className="close-btn" onClick={() => setSelectedThermo(null)}>×</button>
            </div>

            <div className="modal-body">
              {/* Form nuova schedule */}
              <div className="schedule-form">
                <h3>Aggiungi Programmazione</h3>
                
                <div className="form-group">
                  <label>Giorni:</label>
                  <div className="days-grid">
                    {DAYS_NAMES.map((day, idx) => (
                      <button
                        key={idx}
                        className={`day-btn ${newSchedule.days.includes(idx) ? 'active' : ''}`}
                        onClick={() => toggleDay(idx)}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Ora:</label>
                    <input
                      type="number"
                      min="0"
                      max="23"
                      value={newSchedule.hour}
                      onChange={e => setNewSchedule(prev => ({ ...prev, hour: e.target.value }))}
                      placeholder="00"
                    />
                  </div>
                  <div className="form-group">
                    <label>Minuti:</label>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={newSchedule.minute}
                      onChange={e => setNewSchedule(prev => ({ ...prev, minute: e.target.value }))}
                      placeholder="00"
                    />
                  </div>
                  <div className="form-group">
                    <label>Velocità:</label>
                    <select
                      value={newSchedule.speed}
                      onChange={e => setNewSchedule(prev => ({ ...prev, speed: parseInt(e.target.value) }))}
                    >
                      {[0, 1, 2, 3].map(s => (
                        <option key={s} value={s}>{SPEED_LABELS[s]}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <button className="btn btn-primary" onClick={addSchedule} disabled={loading}>
                  Aggiungi
                </button>
              </div>

              {/* Lista schedule esistenti */}
              <div className="schedule-list">
                <h3>Programmazioni</h3>
                {schedules[selectedThermo]?.length > 0 ? (
                  schedules[selectedThermo].map((sched, idx) => (
                    <div key={idx} className={`schedule-item ${sched.active === false ? 'schedule-inactive' : ''}`}>
                      <div className="schedule-info">
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={sched.active !== false}
                            onChange={() => toggleScheduleActive(selectedThermo, idx, sched.active !== false)}
                          />
                          <span className="toggle-slider"></span>
                        </label>
                        <span className="schedule-days">{formatDays(sched.days)}</span>
                        <span className="schedule-time">{formatTime(sched.hour, sched.minute)}</span>
                        <span 
                          className="schedule-speed-badge"
                          style={{ backgroundColor: SPEED_COLORS[sched.speed] }}
                        >
                          {SPEED_LABELS[sched.speed]}
                        </span>
                      </div>
                      <button 
                        className="btn btn-danger btn-small"
                        onClick={() => deleteSchedule(selectedThermo, idx)}
                        title="Elimina"
                      >
                        X
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="no-schedules">Nessuna programmazione</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal tutte le programmazioni */}
      {showAllSchedules && (
        <div className="modal-overlay" onClick={() => setShowAllSchedules(false)}>
          <div className="modal modal-large" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Tutte le Programmazioni</h2>
              <button className="close-btn" onClick={() => setShowAllSchedules(false)}>×</button>
            </div>

            <div className="modal-body">
              {THERMOSTATS.map(thermo => {
                const thermoSchedules = schedules[thermo.id] || []
                if (thermoSchedules.length === 0) return null
                
                return (
                  <div key={thermo.id} className="thermo-schedules-section">
                    <h3 className="thermo-section-title">{thermo.name}</h3>
                    {thermoSchedules.map((sched, idx) => (
                      <div key={idx} className={`schedule-item ${sched.active === false ? 'schedule-inactive' : ''}`}>
                        <div className="schedule-info">
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={sched.active !== false}
                              onChange={() => toggleScheduleActive(thermo.id, idx, sched.active !== false)}
                            />
                            <span className="toggle-slider"></span>
                          </label>
                          <span className="schedule-days">{formatDays(sched.days)}</span>
                          <span className="schedule-time">{formatTime(sched.hour, sched.minute)}</span>
                          <span 
                            className="schedule-speed-badge"
                            style={{ backgroundColor: SPEED_COLORS[sched.speed] }}
                          >
                            {SPEED_LABELS[sched.speed]}
                          </span>
                        </div>
                        <button 
                          className="btn btn-danger btn-small"
                          onClick={() => deleteSchedule(thermo.id, idx)}
                          title="Elimina"
                        >
                          X
                        </button>
                      </div>
                    ))}
                  </div>
                )
              })}
              
              {Object.values(schedules).every(s => !s || s.length === 0) && (
                <p className="no-schedules">Nessuna programmazione configurata</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <p>Smart Office Control System - Powered by AWS Amplify</p>
        <p className="footer-ip">Connesso a: {OFFICE_API_BASE}</p>
      </footer>
    </div>
  )
}

export default App
