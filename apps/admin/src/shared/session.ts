export interface AdminSessionResponse {
  operator: {
    id: string;
    login: string;
  };
  csrfToken: string;
  expiresAt: string;
}
