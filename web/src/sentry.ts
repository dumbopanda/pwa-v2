import * as Sentry from "@sentry/browser";
import { APP_NAME } from "./config";

// Error reports only: no tracing, no replay, no personal data, no breadcrumbs
// (they can carry page text). The SDK sends no personal data by default. Off unless VITE_SENTRY_DSN is set at build time.
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (dsn) {
  Sentry.init({
    dsn,
    environment: APP_NAME,
    beforeBreadcrumb: () => null,
    beforeSend(event) {
      if (event.request) delete event.request.url;   // the page address can hold sign-in tokens
      delete event.user;
      return event;
    },
  });
}
