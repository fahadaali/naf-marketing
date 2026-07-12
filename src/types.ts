import type { Context } from 'hono';

export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  // vars
  APP_TIMEZONE: string;
  APP_NAME: string;
  // secrets
  CLAUDE_API_KEY?: string;
  PROVIDER_API_KEY?: string;
  PROVIDER_NAME?: string;
  AUTH_SECRET?: string;
};

export type Role = 'writer' | 'marketing_manager' | 'general_manager';

export type User = {
  id: string;
  name: string;
  email: string;
  role_name: Role;
  is_active: number;
  created_at: string;
};

export type Variables = {
  user: User;
};

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const ROLE_LABELS: Record<Role, string> = {
  writer: 'كاتب محتوى',
  marketing_manager: 'مدير تسويق',
  general_manager: 'مدير عام',
};
