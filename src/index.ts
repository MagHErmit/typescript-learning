// Import {ExportStocksToXls} from './functions/export-stocks-to-xls';
// import {GoogleAppsScriptOauthCallback} from './functions/google-apps-script-oauth-callback';
// import {GoogleAppsScriptGenerateAuthUrl} from './functions/google-apps-script-generate-auth-url';

// Check if it's Google Cloud Functions production env
// https://cloud.google.com/functions/docs/env-var#environment_variables_set_automatically
// //@ts-expect-error
// const ENV_PROD: boolean = (process.env && (process.env.FUNCTION_NAME || process.env.FUNCTION_TARGET))?.length > 0;
// if (!ENV_PROD) {
//   // eslint-disable-next-line @typescript-eslint/no-var-requires
//   exports.tests = require('./tests').tests;
// }

// exports.exportStocksToXls = ExportStocksToXls.onPubSubMessage;
// exports.googleAppsScriptOauthCallback = GoogleAppsScriptOauthCallback.httpHandler;
// exports.googleAppsScriptGenerateAuthUrl = GoogleAppsScriptGenerateAuthUrl.httpHandler;

import {main} from './First task/first.js';

exports.webContries = (req: any, res: { send: (arg0: any) => any }) => {
  void main().then((str: any) => res.send(str));
};
