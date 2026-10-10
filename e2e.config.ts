import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

export default {
  targets: [
    {
      engine: web(),
      app: {
        url: 'http://127.0.0.1:4177',
        command: {
          executable: 'node',
          args: ['tests/serve-docs.js'],
          log: '.e2e/logs/app.log',
        },
      },
    },
  ],
} satisfies E2EConfig;
