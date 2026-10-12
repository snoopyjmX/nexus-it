// ARCHITECTURE §5, parte de chamados. Cada célula diz se o espectador enxerga o recurso
// (tela/API). Comentários e eventos seguem o chamado. O teste confere cada célula contra can().
export const TICKET_VISIBILITY = {
  chamado: { "requester-owner": true, "requester-other": false, technician: true },
  comentarios: { "requester-owner": true, "requester-other": false, technician: true },
  eventos: { "requester-owner": true, "requester-other": false, technician: true },
} as const;

export const ARTICLE_VISIBILITY = {
  rascunho: { requester: false, technician: true },
  publicado: { requester: true, technician: true },
} as const;
