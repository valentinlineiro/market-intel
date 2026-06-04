declare global {
  namespace App {
    interface Locals {
      session: { authenticated: boolean } | null;
    }
    interface Platform {
      env: {
        DASHBOARD_PASSWORD: string;
        SESSION_SECRET: string;
        WORKER_URL: string;
        WORKER_SECRET: string;
      };
    }
  }
}

export {};
