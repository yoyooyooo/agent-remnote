export type StatusLineConnection = 'ok' | 'down' | 'stale' | 'off' | 'no_client';

export type StatusLineSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'text' }
  | { readonly kind: 'rem'; readonly count: number };

export type StatusLineModel = {
  readonly connection: StatusLineConnection;
  readonly selection: StatusLineSelection;
  readonly queueOutstanding: number;
};

