import type { Response } from 'express';

export interface LiveEvent {
  type: string;
  datasetId: string | null;
  rowId: string | null;
  actorId: string;
}

const clients = new Set<Response>();

export function addClient(res: Response): void {
  clients.add(res);
}

export function removeClient(res: Response): void {
  clients.delete(res);
}

export function publish(event: LiveEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.write(payload);
}

export function clientCount(): number {
  return clients.size;
}
