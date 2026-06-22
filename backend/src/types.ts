export interface JwtPayload {
  id: number;
  username: string;
  role: 'admin' | 'viewer';
}

export interface DbUser {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'viewer';
  created_at: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}
