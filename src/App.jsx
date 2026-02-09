import { useState, useEffect, useCallback } from 'react'
import './App.css'

// Configurazione - tutto passa da AWS API (proxy per evitare mixed content HTTPS/HTTP)
const AWS_API_BASE = 'https://77vpq0kkec.execute-api.eu-south-1.amazonaws.com/prod'

// Lista termostati
const THERMOSTATS = [
  { id: 0, name: 'Martina' },
  { id: 1, name: 'Federico' },
  { id: 2, name: 'Michele' },
  { id: 3, name: 'Franco' },
  { id: 4, name: 'Corridoio' },
  { id: 5, name: 'Commerciale' },
  { id: 6, name: 'Ingresso' },
  { id: 7, name: 'Federica' },
]

const DAYS_NAMES = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
const SPEED_LABELS = { 0: 'OFF', 1: 'V1', 2: 'V2', 3: 'V3' }
const SPEED_COLORS = { 0: '#dc3545', 1: '#28a745', 2: '#ffc107', 3: '#17a2b8' }

function App() {
  const [currentTime, setCurrentTime] = useState(new Date())
  const [schedules, setSchedules] = useState({})
  const [thermoStatus, setThermoStatus] = useState({})
  const [selectedThermo, setSelectedThermo] = useState(null)
  const [showAllSchedules, setShowAllSchedules] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notification, setNotification] = useState(null)
  const [newSchedule, setNewSchedule] = useState({
    days: [],
    hour: '',
    minute: '',
    speed: 0,
    oneTime: false
  })

  // Aggiorna orologio ogni secondo
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Carica schedule e status da AWS all'avvio
  useEffect(() => {
    loadSchedules()
    loadStatus()
    // Ricarica status ogni 30 secondi
    const statusTimer = setInterval(loadStatus, 30000)
    return () => clearInterval(statusTimer)
  }, [])

  // Mostra notifica
  const showNotification = useCallback((message, type = 'success') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 3000)
  }, [])

  // Carica schedule da AWS
  const loadSchedules = async () => {
    try {
      const response = await fetch(`${AWS_API_BASE}/schedules`)
      if (response.ok) {
        const data = await response.json()
        setSchedules(data.schedules || {})
      }
    } catch (error) {
      console.error('Errore caricamento schedule:', error)
      // Inizializza vuoto
      const empty = {}
      THERMOSTATS.forEach((_, idx) => { empty[idx] = [] })
      setSchedules(empty)
    }
  }

  // Carica stato termostati da AWS
  const loadStatus = async () => {
    try {
      const response = await fetch(`${AWS_API_BASE}/status`)
      if (response.ok) {
        const data = await response.json()
        setThermoStatus(data.status || {})
      }
    } catch (error) {
      console.error('Errore caricamento status:', error)
    }
  }

  // Comando manuale termostato (passa da Lambda proxy)
  const setThermostat = async (id, speed) => {
    setLoading(true)
    try {
      const response = await fetch(`${AWS_API_BASE}/thermostat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, speed })
      })
      if (response.ok) {
        showNotification(`${THERMOSTATS[id].name} impostato a ${SPEED_LABELS[speed]}`, 'success')
        // Ricarica stato dopo 1 secondo (tempo per il server di aggiornare)
        setTimeout(loadStatus, 1000)
      } else {
        const err = await response.json()
        throw new Error(err.error || 'Errore risposta server')
      }
    } catch (error) {
      console.error('Errore comando:', error)
      showNotification(`Errore: impossibile impostare ${THERMOSTATS[id].name}`, 'error')
    }
    setLoading(false)
  }

  // Aggiungi nuova schedule (salva su AWS)
  const addSchedule = async () => {
    if (newSchedule.days.length === 0) {
      showNotification('Seleziona almeno un giorno', 'error')
      return
    }
    if (newSchedule.hour === '' || newSchedule.minute === '') {
      showNotification('Inserisci ora e minuti', 'error')
      return
    }

    // Crea array giorni (7 elementi boolean)
    const daysArray = [false, false, false, false, false, false, false]
    newSchedule.days.forEach(d => { daysArray[d] = true })

    setLoading(true)
    try {
      const response = await fetch(`${AWS_API_BASE}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thermoId: selectedThermo,
          days: daysArray,
          hour: parseInt(newSchedule.hour),
          minute: parseInt(newSchedule.minute),
          speed: newSchedule.speed,
          oneTime: newSchedule.oneTime
        })
      })

      if (response.ok) {
        showNotification(newSchedule.oneTime ? 'Programmazione una tantum aggiunta' : 'Programmazione aggiunta', 'success')
        await loadSchedules()
        setNewSchedule({ days: [], hour: '', minute: '', speed: 0, oneTime: false })
      } else {
        throw new Error('Errore risposta server')
      }
    } catch (error) {
      console.error('Errore aggiunta schedule:', error)
      showNotification('Errore nell\'aggiunta', 'error')
    }
    setLoading(false)
  }

  // Elimina schedule (da AWS)
  const deleteSchedule = async (thermoId, scheduleId) => {
    if (!confirm('Eliminare questa programmazione?')) return

    setLoading(true)
    try {
      const response = await fetch(`${AWS_API_BASE}/schedules?thermoId=${thermoId}&scheduleId=${scheduleId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        showNotification('Programmazione eliminata', 'success')
        await loadSchedules()
      }
    } catch (error) {
      console.error('Errore eliminazione:', error)
      showNotification('Errore nell\'eliminazione', 'error')
    }
    setLoading(false)
  }

  // Toggle attiva/disattiva schedule (su AWS)
  const toggleScheduleActive = async (thermoId, scheduleId, currentActive) => {
    setLoading(true)
    try {
      const response = await fetch(`${AWS_API_BASE}/schedules/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thermoId: thermoId,
          scheduleId: scheduleId,
          active: !currentActive
        })
      })

      if (response.ok) {
        showNotification(currentActive ? 'Programmazione disattivata' : 'Programmazione attivata', 'success')
        await loadSchedules()
      }
    } catch (error) {
      console.error('Errore toggle:', error)
      showNotification('Errore nel cambio stato', 'error')
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
    if (!Array.isArray(days)) return ''
    return days
      .map((active, idx) => active ? DAYS_NAMES[idx] : null)
      .filter(Boolean)
      .join(', ')
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
          {THERMOSTATS.map(thermo => {
            const status = thermoStatus[thermo.id]
            const currentSpeed = status?.speed ?? -1
            
            return (
              <div key={thermo.id} className="thermostat-card">
                <div className="thermostat-header">
                  <h2 className="thermostat-name">{thermo.name}</h2>
                  {currentSpeed >= 0 && (
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: SPEED_COLORS[currentSpeed] }}
                    >
                      {SPEED_LABELS[currentSpeed]}
                    </span>
                  )}
                </div>
                
                <div className="speed-buttons">
                  {[0, 1, 2, 3].map(speed => (
                    <button
                      key={speed}
                      className={`speed-btn ${currentSpeed === speed ? 'active' : ''}`}
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
                      <div key={idx} className={`schedule-mini ${sched.active === false ? 'inactive' : ''}`}>
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
            )
          })}
        </div>
      </main>

      {/* Modal programmazione singola */}
      {selectedThermo !== null && (
        <div className="modal-overlay" onClick={() => setSelectedThermo(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Programmazione {THERMOSTATS[selectedThermo].name}</h2>
              <button className="close-btn" onClick={() => setSelectedThermo(null)}>X</button>
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
                    <label>Velocita:</label>
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

                <div className="form-group form-group-inline">
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={newSchedule.oneTime}
                      onChange={e => setNewSchedule(prev => ({ ...prev, oneTime: e.target.checked }))}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <span className="toggle-label">Una tantum (si elimina dopo l'esecuzione)</span>
                </div>

                <button className="btn btn-primary" onClick={addSchedule} disabled={loading}>
                  Aggiungi
                </button>
              </div>

              {/* Lista schedule esistenti */}
              <div className="schedule-list">
                <h3>Programmazioni</h3>
                {schedules[selectedThermo]?.length > 0 ? (
                  schedules[selectedThermo].map((sched) => (
                    <div key={sched.id} className={`schedule-item ${sched.active === false ? 'schedule-inactive' : ''} ${sched.oneTime ? 'schedule-onetime' : ''}`}>
                      <div className="schedule-info">
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={sched.active !== false}
                            onChange={() => toggleScheduleActive(selectedThermo, sched.id, sched.active !== false)}
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
                        {sched.oneTime && <span className="onetime-badge" title="Una tantum">1x</span>}
                      </div>
                      <button 
                        className="btn btn-danger btn-small"
                        onClick={() => deleteSchedule(selectedThermo, sched.id)}
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
              <button className="close-btn" onClick={() => setShowAllSchedules(false)}>X</button>
            </div>

            <div className="modal-body">
              {THERMOSTATS.map(thermo => {
                const thermoSchedules = schedules[thermo.id] || []
                if (thermoSchedules.length === 0) return null
                
                return (
                  <div key={thermo.id} className="thermo-schedules-section">
                    <h3 className="thermo-section-title">{thermo.name}</h3>
                    {thermoSchedules.map((sched) => (
                      <div key={sched.id} className={`schedule-item ${sched.active === false ? 'schedule-inactive' : ''} ${sched.oneTime ? 'schedule-onetime' : ''}`}>
                        <div className="schedule-info">
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={sched.active !== false}
                              onChange={() => toggleScheduleActive(thermo.id, sched.id, sched.active !== false)}
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
                          {sched.oneTime && <span className="onetime-badge" title="Una tantum">1x</span>}
                        </div>
                        <button 
                          className="btn btn-danger btn-small"
                          onClick={() => deleteSchedule(thermo.id, sched.id)}
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


    </div>
  )
}

export default App
