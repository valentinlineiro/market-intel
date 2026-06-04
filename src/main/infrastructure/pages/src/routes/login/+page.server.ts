import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { signSession } from '$lib/auth.js';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.session?.authenticated) throw redirect(302, '/dashboard');
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, platform }) => {
    const env  = (platform as App.Platform).env;
    const data = await request.formData();
    const password = data.get('password');

    if (typeof password !== 'string' || password !== env.DASHBOARD_PASSWORD) {
      return fail(401, { error: 'Contraseña incorrecta' });
    }

    const token = await signSession(env.SESSION_SECRET);
    cookies.set('session', token, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7,
    });
    throw redirect(302, '/dashboard');
  },
};
