/** Auth API client: login / change-password / register (server-side PBKDF2). */
import { apiPost } from './api';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
}

export interface AuthProfile {
  username: string;
  display_name: string;
  role: 'user' | 'admin';
}

export interface AuthLoginResult {
  success: boolean;
  user: AuthUser;
  profile: AuthProfile;
  must_change_password: boolean;
}

export interface AuthRegisterResult {
  success: boolean;
  user: AuthUser;
  profile: AuthProfile;
  must_change_password?: boolean;
}

export interface AuthChangePasswordResult {
  success: boolean;
  must_change_password: boolean;
}

export async function authLogin(username: string, password: string): Promise<AuthLoginResult> {
  return apiPost<AuthLoginResult>('/api/auth/login', { username, password });
}

export async function authChangePassword(args: {
  user_id: string;
  new_password: string;
  current_password?: string;
}): Promise<AuthChangePasswordResult> {
  return apiPost<AuthChangePasswordResult>('/api/auth/change-password', args);
}

export async function authRegister(
  username: string,
  password: string,
  display_name: string,
): Promise<AuthRegisterResult> {
  return apiPost<AuthRegisterResult>('/api/auth/register', {
    username,
    password,
    display_name,
  });
}
