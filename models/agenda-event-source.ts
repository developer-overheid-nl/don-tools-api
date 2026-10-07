export const AgendaEventSource = {
  Manual: "manual",
  Pleio: "pleio",
} as const;
export type AgendaEventSource = (typeof AgendaEventSource)[keyof typeof AgendaEventSource];
