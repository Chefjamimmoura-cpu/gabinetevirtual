'use client';
import React, { useState, useMemo } from 'react';
import Topbar from '@/components/topbar';
import { ChevronLeft, ChevronRight, RefreshCw, Mail, Calendar as CalendarIcon, Inbox, Send, Star, AlertCircle, FileText, Plus, X, Trash2, ExternalLink, CheckCircle, Settings } from 'lucide-react';
import styles from './agenda.module.css';

import { 
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, 
  eachDayOfInterval, isSameMonth, isToday, addMonths, subMonths, 
  addWeeks, subWeeks, addDays, subDays, isSameDay, parseISO 
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

// === Mock Data for Emails ===
type EmailAccount = 'oficial' | 'agenda' | 'pessoal' | 'canais' | 'comissao';

// Generate some mock dates for the current month
const getMockDate = (day: number) => {
  const d = new Date();
  return format(new Date(d.getFullYear(), d.getMonth(), day), 'yyyy-MM-dd');
};

export interface EmailItem {
  id: number;
  account: EmailAccount;
  sender: string;
  subject: string;
  preview: string;
  body?: string;
  date: string;
  unread: boolean;
  isInvite?: boolean;
  eventDetails?: any;
  aliaProcessed?: boolean;
  aliaSummary?: string;
}

// Mocks Removed - Data loaded via Supabase API
const MOCK_EMAILS: EmailItem[] = [];

export type EventType = 'session' | 'institutional' | 'personal';

export interface CalendarEvent {
  id: string;
  date: string; // ISO format 'YYYY-MM-DD'
  title: string;
  type: EventType;
  time?: string;
  location?: string;
}

const INITIAL_EVENTS: CalendarEvent[] = [];

const DAYS_OF_WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HOURS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];

export default function AgendaPage() {
  const [activeView, setActiveView] = useState<'calendar' | 'inbox'>('calendar');
  const [emailFilter, setEmailFilter] = useState<EmailAccount | 'all'>('all');
  const [events, setEvents] = useState<CalendarEvent[]>(INITIAL_EVENTS);
  const [inboxEmails, setInboxEmails] = useState<EmailItem[]>(MOCK_EMAILS);
  const [expandedEmailId, setExpandedEmailId] = useState<number | null>(null);
  
  // Calendar Navigation State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day'>('month');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [modalData, setModalData] = useState<Partial<CalendarEvent>>({ type: 'institutional', title: '', time: '', location: '', date: format(new Date(), 'yyyy-MM-dd') });

  // Custom Confirm State
  const [confirmDialog, setConfirmDialog] = useState<{isOpen: boolean, message: string, onConfirm: () => void}>({
    isOpen: false,
    message: '',
    onConfirm: () => {}
  });

  // Sync / Account Config State
  const [syncAccounts, setSyncAccounts] = useState([
    { id: '1', email: 'caroldantasrr@gmail.com', type: 'Google' },
    { id: '2', email: 'agendacaroldantas@gmail.com', type: 'Google' }
  ]);
  const [activeSyncAccountId, setActiveSyncAccountId] = useState('1');
  const [isSyncDropdownOpen, setIsSyncDropdownOpen] = useState(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [newAccountEmail, setNewAccountEmail] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/agenda/gcal/sync', { method: 'POST' });
      if (res.ok) {
        alert('Sincronização com Google Calendar iniciada com sucesso!');
        window.location.reload();
      } else {
        alert('Falha na sincronização. Verifique as credenciais OAUTH.');
      }
    } catch (err) {
      alert('Erro de conexão ao sincronizar com Google Calendar.');
    } finally {
      setIsSyncing(false);
      setIsSyncDropdownOpen(false);
    }
  };

  // Fetch Logic
  React.useEffect(() => {
    async function loadEventos() {
      try {
        const ano = currentDate.getFullYear();
        const mes = currentDate.getMonth() + 1; // 1-12
        const res = await fetch(`/api/agenda/eventos?ano=${ano}&mes=${mes}&view=month`);
        if (res.ok) {
          const data = await res.json();
          const mappedEvents: CalendarEvent[] = data.map((d: any) => ({
            id: d.id,
            date: d.data_inicio.split('T')[0],
            time: d.data_inicio.includes('T') ? d.data_inicio.split('T')[1].substring(0, 5) : '',
            title: d.titulo,
            type: d.tipo === 'sessao_plenaria' ? 'session' : d.tipo === 'agenda_externa' ? 'personal' : 'institutional',
            location: d.local || ''
          }));
          setEvents(mappedEvents);
        }
      } catch (err) {
        console.error(err);
      }
    }
    loadEventos();
  }, [currentDate]);

  React.useEffect(() => {
    async function loadEmails() {
      if (activeView !== 'inbox') return;
      try {
        const res = await fetch(`/api/agenda/emails`);
        if (res.ok) {
          const data = await res.json();
          const emailList: EmailItem[] = data.emails.map((e: any) => ({
            id: e.id,
            account: e.conta as EmailAccount,
            sender: e.remetente,
            subject: e.assunto,
            preview: e.preview,
            date: new Date(e.data_recebimento).toLocaleDateString('pt-BR'),
            unread: !e.lido,
            body: 'Corpo do email indisponível na prévia...'
          }));
          setInboxEmails(emailList);
        }
      } catch (err) {
        console.error(err);
      }
    }
    loadEmails();
  }, [activeView]);

  const filteredEmails = emailFilter === 'all' 
    ? inboxEmails 
    : inboxEmails.filter(e => e.account === emailFilter);

  // === Calendar Logic ===
  const calendarDays = useMemo(() => {
    let startDate: Date;
    let endDate: Date;

    if (calendarView === 'month') {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(monthStart);
      startDate = startOfWeek(monthStart);
      endDate = endOfWeek(monthEnd);
    } else if (calendarView === 'week') {
      startDate = startOfWeek(currentDate);
      endDate = endOfWeek(currentDate);
    } else {
      // Day view
      startDate = currentDate;
      endDate = currentDate;
    }

    const dateFormat = 'yyyy-MM-dd';
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    return days.map(day => {
      const formattedDate = format(day, dateFormat);
      return {
        dateObj: day,
        formattedDate,
        displayDay: format(day, 'd'),
        displayWeekDay: format(day, 'EEEE', { locale: ptBR }),
        isCurrentMonth: isSameMonth(day, currentDate),
        isToday: isToday(day),
        events: events.filter(e => e.date === formattedDate).sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'))
      };
    });
  }, [currentDate, events, calendarView]);

  const todaysEvents = useMemo(() => {
    const todayFormatted = format(new Date(), 'yyyy-MM-dd');
    return events.filter(e => e.date === todayFormatted).sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));
  }, [events]);

  const nextPeriod = () => {
    if (calendarView === 'month') setCurrentDate(addMonths(currentDate, 1));
    else if (calendarView === 'week') setCurrentDate(addDays(currentDate, 7));
    else setCurrentDate(addDays(currentDate, 1));
  };

  const prevPeriod = () => {
    if (calendarView === 'month') setCurrentDate(subMonths(currentDate, 1));
    else if (calendarView === 'week') setCurrentDate(subDays(currentDate, 7));
    else setCurrentDate(subDays(currentDate, 1));
  };

  const goToToday = () => setCurrentDate(new Date());

  const handleOpenModal = (dateStr?: string, existingEvent?: CalendarEvent) => {
    if (existingEvent) {
      setEditingEvent(existingEvent);
      setModalData(existingEvent);
    } else {
      setEditingEvent(null);
      setModalData({ 
        date: dateStr || format(new Date(), 'yyyy-MM-dd'), 
        type: 'institutional', 
        title: '', 
        time: '', 
        location: '' 
      });
    }
    setIsModalOpen(true);
  };

  // Mapeia EventType (frontend) ↔ tipo (API Supabase)
  const toApiTipo = (type: EventType): string => {
    if (type === 'session') return 'sessao_plenaria';
    if (type === 'personal') return 'agenda_externa';
    return 'reuniao';
  };

  // Combina data 'YYYY-MM-DD' + hora 'HH:MM' em ISO string
  const toDataInicio = (date: string, time?: string): string => {
    const t = time && /^\d{2}:\d{2}$/.test(time) ? time : '00:00';
    return `${date}T${t}:00`;
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalData.title || !modalData.date) return;

    const payload = {
      titulo: modalData.title,
      data_inicio: toDataInicio(modalData.date!, modalData.time),
      tipo: toApiTipo((modalData.type as EventType) ?? 'institutional'),
      local: modalData.location || undefined,
    };

    if (editingEvent) {
      const res = await fetch(`/api/agenda/eventos/${editingEvent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setEvents(events.map(ev =>
          ev.id === editingEvent.id ? { ...ev, ...modalData } as CalendarEvent : ev
        ));
      }
    } else {
      const res = await fetch('/api/agenda/eventos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const created = await res.json();
        const newEvent: CalendarEvent = {
          id: String(created.id),
          date: modalData.date!,
          title: modalData.title!,
          type: (modalData.type as EventType) ?? 'institutional',
          time: modalData.time,
          location: modalData.location,
        };
        setEvents([...events, newEvent]);
      }
    }
    setIsModalOpen(false);
  };

  const handleAcceptInvite = (emailId: number, evDetails: any) => {
    const newEvent: CalendarEvent = {
      id: Math.random().toString(36).substr(2, 9),
      ...evDetails
    };
    setEvents([...events, newEvent]);
    
    setInboxEmails(inboxEmails.map(e => {
      if (e.id === emailId) {
        return { ...e, isInvite: false, unread: false };
      }
      return e;
    }));
  };

  const handleDeleteEvent = async () => {
    if (editingEvent) {
      const res = await fetch(`/api/agenda/eventos/${editingEvent.id}`, { method: 'DELETE' });
      if (res.ok) {
        setEvents(events.filter(ev => ev.id !== editingEvent.id));
      }
      setIsModalOpen(false);
    }
  };

  // Drag and Drop Logic
  const handleDragStart = (e: React.DragEvent, event: CalendarEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData('application/json', JSON.stringify(event));
  };

  const handleDropOnDay = (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    const eventData = e.dataTransfer.getData('application/json');
    if (eventData) {
      const parsedEvent = JSON.parse(eventData) as CalendarEvent;
      if (parsedEvent.date === targetDate) return;

      const dateStr = format(parseISO(targetDate), 'dd/MM/yyyy');
      setConfirmDialog({
        isOpen: true,
        message: `Deseja mover o compromisso "${parsedEvent.title}" para o dia ${dateStr}?`,
        onConfirm: async () => {
          const res = await fetch(`/api/agenda/eventos/${parsedEvent.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_inicio: toDataInicio(targetDate, parsedEvent.time) }),
          });
          if (res.ok) {
            setEvents(prev => prev.map(ev => ev.id === parsedEvent.id ? { ...ev, date: targetDate } : ev));
          }
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }
      });
    }
  };

  const handleDropOnHour = (e: React.DragEvent, targetDate: string, targetHour: string) => {
    e.preventDefault();
    const eventData = e.dataTransfer.getData('application/json');
    if (eventData) {
      const parsedEvent = JSON.parse(eventData) as CalendarEvent;
      const parsedHourPrefix = parsedEvent.time?.split(':')[0];
      const targetHourPrefix = targetHour.split(':')[0];

      if (parsedEvent.date === targetDate && parsedHourPrefix === targetHourPrefix) return;

      const dateStr = format(parseISO(targetDate), 'dd/MM/yyyy');
      setConfirmDialog({
        isOpen: true,
        message: `Deseja reagendar o evento "${parsedEvent.title}" para as ${targetHour} do dia ${dateStr}?`,
        onConfirm: async () => {
          const res = await fetch(`/api/agenda/eventos/${parsedEvent.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_inicio: toDataInicio(targetDate, targetHour) }),
          });
          if (res.ok) {
            setEvents(prev => prev.map(ev => ev.id === parsedEvent.id ? { ...ev, date: targetDate, time: targetHour } : ev));
          }
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }
      });
    }
  };
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  return (
    <>
      <Topbar title="Agenda Institucional" subtitle="Coordenação de Compromissos e Comunicações" />
      
      <div className={styles.container}>
        
        {/* Painel Principal (Switch Calendar/Inbox) */}
        <section className={styles.mainPanel}>
          
          <div className={styles.panelControls}>
             <div className={styles.viewToggleGroup}>
               <button 
                 className={`${styles.toggleBtn} ${activeView === 'calendar' ? styles.activeToggle : ''}`}
                 onClick={() => setActiveView('calendar')}
               >
                 <CalendarIcon size={16} /> Painel de Agenda
               </button>
               <button 
                 className={`${styles.toggleBtn} ${activeView === 'inbox' ? styles.activeToggle : ''}`}
                 onClick={() => setActiveView('inbox')}
                 style={activeView === 'inbox' ? { background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' } : {}}
               >
                 <Inbox size={16} /> Triagem ALIA (E-mails & Convites)
               </button>
             </div>
             {activeView === 'calendar' && (
               <button className={styles.btnNova} onClick={() => handleOpenModal()} style={{ marginLeft: 'auto' }}>
                 <Plus size={16} /> Novo Evento
               </button>
             )}
          </div>
          
          {/* Calendar View */}
          {activeView === 'calendar' && (
            <div className={styles.calendarMain}>
              <div className={styles.calendarHeader}>
                <div className={styles.headerLeft}>
                  <h2 className={styles.monthTitle}>
                    {calendarView === 'month' && format(currentDate, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())}
                    {calendarView === 'week' && `Semana de ${format(calendarDays[0].dateObj, 'd/MMM', { locale: ptBR })} - ${format(calendarDays[calendarDays.length-1].dateObj, 'd/MMM', { locale: ptBR })}`}
                    {calendarView === 'day' && format(currentDate, "d 'de' MMMM yyyy", { locale: ptBR }).replace(/^\d+\s\w+\s\w/, c => c.toLowerCase()).replace(/^\w/, c => c.toUpperCase())}
                  </h2>
                  <div className={styles.navGroup}>
                    <button className={styles.iconBtn} onClick={prevPeriod}><ChevronLeft size={16} /></button>
                    <button className={styles.iconBtn} onClick={nextPeriod}><ChevronRight size={16} /></button>
                  </div>
                  <button className={styles.todayBtn} onClick={goToToday}>Hoje</button>
                </div>
                
                <div className={styles.viewGroup}>
                  <button className={`${styles.viewBtn} ${calendarView === 'month' ? styles.active : ''}`} onClick={() => setCalendarView('month')}>Mês</button>
                  <button className={`${styles.viewBtn} ${calendarView === 'week' ? styles.active : ''}`} onClick={() => setCalendarView('week')}>Semana</button>
                  <button className={`${styles.viewBtn} ${calendarView === 'day' ? styles.active : ''}`} onClick={() => setCalendarView('day')}>Dia</button>
                </div>
              </div>

              {calendarView === 'month' && (
                <div className={styles.gridHeader}>
                  {DAYS_OF_WEEK.map(day => (
                    <div key={day} className={styles.dayName}>{day}</div>
                  ))}
                </div>
              )}

              <div className={`${styles.gridBody} ${calendarView === 'week' ? styles.gridWeek : ''} ${calendarView === 'day' ? styles.gridDay : ''}`}>
                {calendarDays.map((d, index) => (
                  <div 
                    key={index} 
                    className={`${styles.gridCell} ${!d.isCurrentMonth && calendarView === 'month' ? styles.isDifferentMonth : ''} ${calendarView === 'day' ? styles.gridCellDayView : ''}`}
                    onClick={() => {
                      if (calendarView === 'day') {
                        // handled by hour slots
                      } else {
                        setCurrentDate(d.dateObj);
                        setCalendarView('day');
                      }
                    }}
                    onDragOver={calendarView !== 'day' ? handleDragOver : undefined}
                    onDrop={calendarView !== 'day' ? (e) => handleDropOnDay(e, d.formattedDate) : undefined}
                  >
                    {calendarView !== 'day' && (
                      <div className={`${styles.dayHeader} ${calendarView !== 'month' ? styles.dayHeaderExpanded : ''}`}>
                        {calendarView !== 'month' && <span className={styles.dayWeekName}>{d.displayWeekDay}</span>}
                        <div className={`${styles.dayNumber} ${d.isToday ? styles.isToday : ''}`}>
                          {d.displayDay}
                        </div>
                      </div>
                    )}
                    
                    {calendarView === 'day' ? (
                      <div className={styles.dayHourlyGrid}>
                        {HOURS.map(hour => {
                          const hourPrefix = hour.split(':')[0];
                          const hourEvents = d.events.filter(ev => ev.time?.startsWith(hourPrefix));
                          return (
                            <div 
                              key={hour} 
                              className={styles.hourSlot}
                              onClick={(e) => { e.stopPropagation(); handleOpenModal(d.formattedDate); setModalData(prev => ({ ...prev, time: hour })); }}
                              onDragOver={handleDragOver}
                              onDrop={(e) => handleDropOnHour(e, d.formattedDate, hour)}
                            >
                              <div className={styles.hourLabel}>{hour}</div>
                              <div className={styles.hourEventsArea}>
                                {hourEvents.map((ev) => (
                                  <div 
                                    key={ev.id} 
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, ev)}
                                    onClick={(e) => { e.stopPropagation(); handleOpenModal(d.formattedDate, ev); }}
                                    className={`${styles.eventPill} ${styles.eventPillExpanded} ${
                                      ev.type === 'session' ? styles.pillSession : 
                                      ev.type === 'institutional' ? styles.pillInstitutional : 
                                      styles.pillPersonal
                                    }`}
                                    title={`${ev.time ? ev.time + ' - ' : ''}${ev.title}`}
                                  >
                                    <span className={styles.pillText}>
                                      {ev.time && <span className={styles.pillTime}>{ev.time}</span>}
                                      {ev.title}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        {/* Eventos sem horario fixo no dia */}
                        {d.events.filter(ev => !ev.time || ev.time < '08:00' || ev.time > '20:59').length > 0 && (
                          <div className={styles.hourSlot} style={{ marginTop: '20px' }}>
                             <div className={styles.hourLabel}>Outros</div>
                             <div className={styles.hourEventsArea}>
                                {d.events.filter(ev => !ev.time || ev.time < '08:00' || ev.time > '20:59').map((ev) => (
                                  <div 
                                    key={ev.id} 
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, ev)}
                                    onClick={(e) => { e.stopPropagation(); handleOpenModal(d.formattedDate, ev); }}
                                    className={`${styles.eventPill} ${styles.eventPillExpanded} ${
                                      ev.type === 'session' ? styles.pillSession : 
                                      ev.type === 'institutional' ? styles.pillInstitutional : 
                                      styles.pillPersonal
                                    }`}
                                  >
                                    <span className={styles.pillText}>{ev.time && <span className={styles.pillTime}>{ev.time}</span>} {ev.title}</span>
                                  </div>
                                ))}
                             </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className={`${styles.eventsContainer} ${calendarView !== 'month' ? styles.eventsContainerExpanded : ''}`}>
                        {d.events.map((ev) => (
                          <div 
                            key={ev.id} 
                            draggable
                            onDragStart={(e) => handleDragStart(e, ev)}
                            onClick={(e) => { e.stopPropagation(); handleOpenModal(d.formattedDate, ev); }}
                            className={`${styles.eventPill} ${calendarView !== 'month' ? styles.eventPillExpanded : ''} ${
                              ev.type === 'session' ? styles.pillSession : 
                              ev.type === 'institutional' ? styles.pillInstitutional : 
                              styles.pillPersonal
                            }`}
                            title={`${ev.time ? ev.time + ' - ' : ''}${ev.title}`}
                          >
                            <span className={styles.pillText}>
                              {ev.time && <span className={styles.pillTime}>{ev.time}</span>}
                              {ev.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inbox View */}
          {activeView === 'inbox' && (
            <div className={styles.inboxContainer}>
              <div className={styles.inboxSidebar}>
                <div className={styles.inboxFilters}>
                  <button className={`${styles.filterBtn} ${emailFilter === 'all' ? styles.activeFilter : ''}`} onClick={() => setEmailFilter('all')}>
                    <Inbox size={16} /> Tudo
                  </button>
                  <button className={`${styles.filterBtn} ${emailFilter === 'oficial' ? styles.activeFilter : ''}`} onClick={() => setEmailFilter('oficial')}>
                    <Mail size={16} /> Oficial (CMBV) <span className={styles.badgeCount}>2</span>
                  </button>
                  <button className={`${styles.filterBtn} ${emailFilter === 'agenda' ? styles.activeFilter : ''}`} onClick={() => setEmailFilter('agenda')}>
                    <CalendarIcon size={16} /> Agenda Carol
                  </button>
                  <button className={`${styles.filterBtn} ${emailFilter === 'comissao' ? styles.activeFilter : ''}`} onClick={() => setEmailFilter('comissao')}>
                    <FileText size={16} /> Comissão (CASP)
                  </button>
                  <button className={`${styles.filterBtn} ${emailFilter === 'canais' ? styles.activeFilter : ''}`} onClick={() => setEmailFilter('canais')}>
                    <Star size={16} /> Canais Digitais
                  </button>
                  <button className={`${styles.filterBtn} ${emailFilter === 'pessoal' ? styles.activeFilter : ''}`} onClick={() => setEmailFilter('pessoal')}>
                    <AlertCircle size={16} /> Pessoal
                  </button>
                </div>
              </div>

              <div className={styles.inboxList}>
                <div className={styles.inboxHeader}>
                  <h3 className={styles.inboxTitle}>
                    {emailFilter === 'all' && 'Todas as Caixas'}
                    {emailFilter === 'oficial' && 'Oficial (caroldantasrr@gmail.com)'}
                    {emailFilter === 'agenda' && 'Agenda (agendacaroldantas@gmail.com)'}
                    {emailFilter === 'comissao' && 'Comissão (comissaocasp1@gmail.com)'}
                    {emailFilter === 'canais' && 'Canais (canalcaroldantas@gmail.com)'}
                    {emailFilter === 'pessoal' && 'Pessoal (carolinydantas@hotmail.com)'}
                  </h3>
                  <button className={styles.iconBtn}><RefreshCw size={14} /></button>
                </div>
                
                <div className={styles.emailsWrapper}>
                  {filteredEmails.map(email => (
                    <div 
                      key={email.id} 
                      className={`${styles.emailItem} ${email.unread ? styles.unreadItem : ''} ${expandedEmailId === email.id ? styles.expandedItem : ''}`}
                      onClick={() => setExpandedEmailId(expandedEmailId === email.id ? null : email.id)}
                    >
                      <div className={styles.emailLeft}>
                        {email.unread && <div className={styles.unreadDot} />}
                        <div className={styles.emailAvatar}>
                          {email.sender.charAt(0)}
                        </div>
                      </div>
                      <div className={styles.emailContent}>
                        <div className={styles.emailTopGroup}>
                          <span className={styles.emailSender}>{email.sender}</span>
                          <span className={styles.emailDate}>{email.date}</span>
                        </div>
                        <div className={styles.emailSubject}>{email.subject}</div>
                        
                        {expandedEmailId !== email.id ? (
                          <div className={styles.emailPreview}>{email.preview}</div>
                        ) : (
                          <div className={styles.emailBodyFull}>
                            {email.body?.split('\n').map((paragraph, i) => (
                              <p key={i}>{paragraph}</p>
                            ))}
                          </div>
                        )}

                        {/* ALIA Agentic Card */}
                        {email.aliaProcessed && (
                          <div style={{ marginTop: '12px', padding: '12px', background: '#f0fdf4', borderRadius: '8px', borderLeft: '4px solid #22c55e', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#166534', fontWeight: 600, fontSize: '0.85rem' }}>
                              <Star size={16} fill="#22c55e" color="#22c55e" />
                              <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ação Pendente (ALIA)</span>
                            </div>
                            <span style={{ fontSize: '0.9rem', color: '#14532d' }}>{email.aliaSummary}</span>
                            
                            {email.isInvite && email.eventDetails && (
                               <button className={styles.emailActionAccept} onClick={(e) => { e.stopPropagation(); handleAcceptInvite(email.id, email.eventDetails); }} style={{ alignSelf: 'flex-start', background: '#22c55e', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 2px 4px rgba(34, 197, 94, 0.3)' }}>
                                 <CheckCircle size={16} /> Aceitar e Reservar ({email.eventDetails.date} às {email.eventDetails.time})
                               </button>
                            )}
                          </div>
                        )}
                        
                        {expandedEmailId === email.id && (
                          <div className={styles.emailActionsGroup}>
                            <a href="https://mail.google.com" target="_blank" rel="noreferrer" className={styles.emailActionLink} onClick={(e) => e.stopPropagation()}>
                              <ExternalLink size={14} /> Abrir Original
                            </a>
                            {!email.aliaProcessed && email.isInvite && email.eventDetails && (
                              <button className={styles.emailActionAccept} onClick={(e) => { e.stopPropagation(); handleAcceptInvite(email.id, email.eventDetails); }}>
                                <CheckCircle size={14} /> Adicionar Manual ({email.eventDetails.date})
                              </button>
                            )}
                          </div>
                        )}

                        {emailFilter === 'all' && (
                          <span className={`${styles.accBadge} ${styles['acc' + email.account]}`}>
                            {email.account}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </section>

        {/* Painel Direito: Today's Agenda (Sempre Visível) */}
        <aside className={styles.sidePanel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Hoje no Radar</h3>
            <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
              <button 
                className={styles.syncBtn} 
                title={`Sincronizado via ${syncAccounts.find(a => a.id === activeSyncAccountId)?.email || 'Sem Conta'}`}
                onClick={() => setIsSyncDropdownOpen(!isSyncDropdownOpen)}
              >
                <RefreshCw size={14} /> 
                <span className={styles.syncEmail}>
                  Sync ({syncAccounts.find(a => a.id === activeSyncAccountId)?.email.split('@')[0] || 'Nenhuma'}...)
                </span>
              </button>
              
              {isSyncDropdownOpen && (
                <div className={styles.syncDropdown}>
                  <div className={styles.syncDropdownHeader}>Google Calendar</div>
                  {syncAccounts.map(acc => (
                    <div 
                      key={acc.id} 
                      className={`${styles.syncAccountItem} ${acc.id === activeSyncAccountId ? styles.active : ''}`}
                      onClick={() => { setActiveSyncAccountId(acc.id); setIsSyncDropdownOpen(false); }}
                    >
                      <div className={styles.syncAccountDot} />
                      {acc.email}
                    </div>
                  ))}
                  {syncAccounts.length === 0 && (
                    <div style={{ padding: '8px 16px', fontSize: '0.8rem', color: '#94a3b8' }}>Nenhuma conta vinculada</div>
                  )}
                  <div className={styles.syncDropdownDivider} />
                  <div 
                    className={styles.syncConfigBtn}
                    onClick={handleManualSync}
                    style={{ color: '#10b981', borderBottom: '1px solid #f1f5f9' }}
                  >
                    <RefreshCw size={14} /> {isSyncing ? 'Sincronizando...' : 'Forçar Sincronização'}
                  </div>
                  <div 
                    className={styles.syncConfigBtn}
                    onClick={() => { setIsSyncDropdownOpen(false); setIsConfigModalOpen(true); }}
                  >
                    <Settings size={14} /> Configurar Contas...
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={styles.timeline}>
            {todaysEvents.length === 0 && (
               <div style={{ textAlign: 'center', padding: '32px 0', color: '#6b7280', fontSize: '0.9rem' }}>
                 Sem eventos programados para hoje.
               </div>
            )}
            
            {todaysEvents.map((ev, i) => (
              <div key={ev.id} className={styles.timelineItem}>
                <div className={styles.timelineTime}>
                  <div className={`${styles.timeDot} ${
                    ev.type === 'session' ? styles.blue : 
                    ev.type === 'personal' ? styles.pink : 
                    styles.gray
                  }`}></div>
                  <span className={styles.timeText}>{ev.time || '--:--'}</span>
                </div>
                <div className={`${styles.timelineCard} ${ev.type === 'personal' && ev.title.includes('Entrevista') ? styles.urgentCard : ''}`} onClick={() => handleOpenModal(ev.date, ev)} style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className={styles.cardTitle}>{ev.title}</div>
                      {ev.location && <div className={styles.cardSubtitle}>{ev.location}</div>}
                    </div>
                    <span className={`${styles.badgeCard} ${
                      ev.type === 'session' ? styles.badgeSession :
                      ev.type === 'personal' ? styles.badgePersonal :
                      styles.badgeInst
                    }`}>
                      {ev.type.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Total Neste Mês</div>
            <div className={styles.summaryCount}>{events.length} Compromissos</div>
            <div className={styles.summaryBars}>
              <div className={`${styles.bar} ${styles.barInst}`} title="Sessões"></div>
              <div className={`${styles.bar} ${styles.barPers}`} title="Institucional"></div>
              <div className={`${styles.bar} ${styles.barEmpty}`} title="Pessoal"></div>
            </div>
          </div>

        </aside>
      </div>

      {/* Modal Criar/Editar Evento */}
      {isModalOpen && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitulo}>{editingEvent ? 'Editar Evento' : 'Novo Evento'}</h2>
              <button onClick={() => setIsModalOpen(false)} className={styles.btnFechar}><X size={20}/></button>
            </div>
            
            <form onSubmit={handleSaveEvent}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Título do Evento *</label>
                <input 
                  type="text" 
                  autoFocus
                  required
                  value={modalData.title} 
                  onChange={e => setModalData({...modalData, title: e.target.value})} 
                  className={styles.input} 
                  placeholder="Ex: Reunião com Moradores" 
                />
              </div>

              <div style={{ display: 'flex', gap: '16px' }}>
                <div className={styles.formGroup} style={{ flex: 1 }}>
                  <label className={styles.label}>Data *</label>
                  <input 
                    type="date" 
                    required
                    value={modalData.date} 
                    onChange={e => setModalData({...modalData, date: e.target.value})} 
                    className={styles.input} 
                  />
                </div>
                <div className={styles.formGroup} style={{ flex: 1 }}>
                  <label className={styles.label}>Horário</label>
                  <input 
                    type="time" 
                    value={modalData.time} 
                    onChange={e => setModalData({...modalData, time: e.target.value})} 
                    className={styles.input} 
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Local / Endereço</label>
                <input 
                  type="text" 
                  value={modalData.location} 
                  onChange={e => setModalData({...modalData, location: e.target.value})} 
                  className={styles.input} 
                  placeholder="Ex: Plenário / Rua X..." 
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Tipo de Classificação</label>
                <select 
                  value={modalData.type} 
                  onChange={e => setModalData({...modalData, type: e.target.value as EventType})} 
                  className={styles.select}
                >
                  <option value="session">Legislativo / Sessão (Azul Escuro)</option>
                  <option value="institutional">Institucional / Comissões (Azul Claro)</option>
                  <option value="personal">Gabinete / Externo (Rosa)</option>
                </select>
              </div>

              <div className={styles.btnRow}>
                {editingEvent && (
                  <button type="button" onClick={handleDeleteEvent} className={styles.btnDanger} style={{ marginRight: 'auto' }}>
                    <Trash2 size={16} style={{ marginRight: '6px' }} /> Excluir
                  </button>
                )}
                <button type="button" onClick={() => setIsModalOpen(false)} className={styles.btnCardSecundario}>Cancelar</button>
                <button type="submit" className={styles.btnNova}>
                  {editingEvent ? 'Salvar Alterações' : 'Criar Evento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Customizado de Confirmação */}
      {confirmDialog.isOpen && (
        <div className={styles.overlay} style={{ zIndex: 1100 }}>
          <div className={styles.alertModal}>
            <div className={styles.alertHeader}>
              <AlertCircle size={24} color="#488DC7" />
              <h3>Confirmar Alteração</h3>
            </div>
            <p className={styles.alertText}>{confirmDialog.message}</p>
            <div className={styles.alertActions}>
              <button className={styles.btnCancelar} onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}>
                Cancelar
              </button>
              <button className={styles.btnSalvar} onClick={confirmDialog.onConfirm}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Configuração de Contas / Sync */}
      {isConfigModalOpen && (
        <div className={styles.overlay} style={{ zIndex: 1100 }}>
          <div className={styles.modal} style={{ maxWidth: '500px' }}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitulo}>
                <Settings size={20} style={{ marginRight: '8px', display: 'inline' }} /> Configurar Sincronização
              </h2>
              <button onClick={() => setIsConfigModalOpen(false)} className={styles.btnFechar}><X size={20}/></button>
            </div>
            
            <div style={{ padding: '0 24px 24px 24px' }}>
               <h3 style={{ fontSize: '0.95rem', color: '#1e293b', marginBottom: '12px' }}>Contas Calendário e Email</h3>
               <div className={styles.accountsList}>
                 {syncAccounts.length === 0 && (
                    <div style={{ fontSize: '0.85rem', color: '#64748b', padding: '12px', textAlign: 'center' }}>Nenhuma conta Google conectada.</div>
                 )}
                 {syncAccounts.map(acc => (
                   <div key={acc.id} className={styles.accountRow}>
                     <div className={styles.accountInfo}>
                        <Mail size={16} color="#64748b" />
                        <span>{acc.email}</span>
                        <span className={styles.accountTypeBadge}>{acc.type}</span>
                     </div>
                     <button 
                       className={styles.iconBtnDanger} 
                       onClick={() => setSyncAccounts(syncAccounts.filter(a => a.id !== acc.id))}
                       title="Desvincular conta"
                     >
                        <Trash2 size={16} />
                     </button>
                   </div>
                 ))}
               </div>

               <h3 style={{ fontSize: '0.95rem', color: '#1e293b', marginTop: '24px', marginBottom: '12px' }}>Adicionar Nova Conta Google</h3>
               <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="email" 
                    placeholder="Ex: agenda@gabinete.com" 
                    className={styles.input} 
                    value={newAccountEmail}
                    onChange={(e) => setNewAccountEmail(e.target.value)}
                  />
                  <button 
                    className={styles.btnSalvar} 
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={() => {
                      window.location.href = '/api/auth/google';
                    }}
                  >
                    Conectar Google
                  </button>
               </div>
               <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '12px', lineHeight: '1.4' }}>
                 Ao conectar, você será redirecionado para a página segura de autorização (OAuth2) do provedor para conceder permissão de leitura de Caixa de Entrada e Calendário.
               </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

