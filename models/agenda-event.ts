export interface AgendaEvent {
  title: string;
  summary?: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  url: string;
  id: string;
  source: AgendaEventSource;
  sourceName?: string;
  createdAt: string;
  updatedAt: string;
}
export namespace AgendaEvent {}
