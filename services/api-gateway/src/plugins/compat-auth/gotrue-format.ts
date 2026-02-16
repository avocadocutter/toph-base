export interface GoTrueUser {
  id: string;
  aud: string;
  role: string;
  email: string;
  email_confirmed_at: string | null;
  phone: string;
  confirmed_at: string | null;
  last_sign_in_at: string | null;
  app_metadata: { provider: string; providers: string[] };
  user_metadata: Record<string, unknown>;
  identities: Array<{
    id: string;
    user_id: string;
    identity_data: { email: string; sub: string };
    provider: string;
    last_sign_in_at: string | null;
    created_at: string;
    updated_at: string;
  }>;
  is_anonymous: boolean;
  created_at: string;
  updated_at: string;
}

export interface GoTrueSession {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
  refresh_token: string;
  user: GoTrueUser;
}

export function toGoTrueUser(row: Record<string, unknown>): GoTrueUser {
  const id = row.id as string;
  const email = row.email as string;
  const createdAt = row.created_at ? new Date(row.created_at as string).toISOString() : new Date().toISOString();
  const updatedAt = row.updated_at ? new Date(row.updated_at as string).toISOString() : createdAt;
  const emailConfirmed = row.email_confirmed as boolean;
  const confirmedAt = emailConfirmed ? createdAt : null;
  const lastSignInAt = row.last_sign_in_at ? new Date(row.last_sign_in_at as string).toISOString() : null;
  const metadata = (row.metadata as Record<string, unknown>) ?? {};

  return {
    id,
    aud: 'authenticated',
    role: (row.role as string) ?? 'authenticated',
    email,
    email_confirmed_at: confirmedAt,
    phone: '',
    confirmed_at: confirmedAt,
    last_sign_in_at: lastSignInAt,
    app_metadata: {
      provider: 'email',
      providers: ['email'],
    },
    user_metadata: metadata,
    identities: [
      {
        id,
        user_id: id,
        identity_data: { email, sub: id },
        provider: 'email',
        last_sign_in_at: lastSignInAt,
        created_at: createdAt,
        updated_at: updatedAt,
      },
    ],
    is_anonymous: false,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function toGoTrueSession(
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  user: GoTrueUser,
): GoTrueSession {
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: refreshToken,
    user,
  };
}
