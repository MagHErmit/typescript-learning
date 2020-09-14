/* eslint-disable max-params */
import {Request, Response} from 'express';
import auth from 'basic-auth';
import {Storage} from '@google-cloud/storage';
import {posix} from 'path';
import {DateTime} from 'luxon';
import {
  AbstractCloudFunction,
  CloudFunctionExecutionParameters
} from '@dobromyslov/cloud-functions-ext/build/src/abstract-cloud-function';
import Firestore, {Timestamp} from '@google-cloud/firestore/build/src';
import {PassThrough} from 'stream';
import {v4 as uuidv4} from 'uuid';
import {parse} from 'cookie';

/**
 * Basic auth credentials.
 */
export interface BasicCredentials {
  /**
   * Username.
   */
  username: string;

  /**
   * Password.
   */
  password: string;
}

/**
 * 1C exchange settings.
 */
export interface Settings extends BasicCredentials {
  /**
   * Zip bundle import or separate files.
   */
  zip: boolean;

  /**
   * Limit of file part size.
   * @default 9mb
   */
  fileSizeLimit: number;

  /**
   * Exchange session duration.
   * @default sessionId
   */
  sessionDurationSeconds: number;

  /**
   * Cookie name.
   * @default sessionId
   */
  sessionIdCookieName: string;

  /**
   * CSRF protection.
   * @default false
   */
  csrfProtection: boolean;

  /**
   * CSRF token name.
   * @default csrfToken
   */
  csrfTokenName: string;

  /**
   * Sessions storage path.
   * @default settingsPath + '/exchange1cSessions'
   */
  sessionsStoragePath: string;
}

/**
 * 1C exchange session info from the incoming request.
 */
export interface RequestSessionInfo {
  /**
   * Session ID from cookie value.
   */
  sessionId: string;

  /**
   * CSRF protection token.
   */
  csrfToken: string;
}

/**
 * 1C Exchange Session.
 */
export interface ExchangeSession extends RequestSessionInfo {
  /**
   * Expiration timestamp.
   * Calculated as moment of successful `checkauth` + session duration in seconds (defined in settings).
   */
  expirationTimestamp: Date;
}

/**
 * 1C Exchange Session stored in the Firestore.
 * expirationTimestamp is loaded from the Firestore as Timestamp and needs to be converted to JS Date after load.
 * @private
 */
interface ExchangeSessionStoredInFirestore extends RequestSessionInfo{
  expirationTimestamp: Timestamp;
}

/**
 * 1C exchange implementation.
 * See https://v8.1c.ru/tekhnologii/obmen-dannymi-i-integratsiya/standarty-i-formaty/protokol-obmena-s-saytom/
 */
export class Exchange1c extends AbstractCloudFunction {
  /**
   * Loaded 1C exchange settings cache.
   */
  protected settings: Settings;

  /**
   * 1C exchange session duration in seconds starting from `checkauth`.
   * Within this period 1C must upload all files and run import for uploaded XML files.
   * @default 3600 seconds (60 minutes).
   */
  protected exchangeSessionDurationSeconds = 3600;

  /**
   * Firestore instance.
   */
  protected firestore = new Firestore();

  /**
   * @param settings
   * @protected
   */
  protected constructor(settings: Settings) {
    super();
    this.settings = settings;
  }

  /**
   * Creates new instance.
   * @param settingsPath Path to the 1C exchange settings.
   */
  public static async create(settingsPath: string): Promise<Exchange1c> {
    return new Exchange1c(await Exchange1c.getSettings(settingsPath));
  }

  public static async httpHandler(request: Request, response: Response): Promise<void> {
    await (await Exchange1c.create('/settings/your-site-name')).onHttpRequest(request, response);
  }

  /**
   * Loads and returns settings.
   * @param settingsPath
   */
  protected static async getSettings(settingsPath: string): Promise<Settings> {
    // Default settings
    const settings: Settings = {
      username: '',
      password: '',
      zip: false,
      fileSizeLimit: 9 * 1024 * 1024,
      sessionDurationSeconds: 60 * 60,
      sessionIdCookieName: 'sessionId',
      csrfProtection: false,
      csrfTokenName: 'csrfToken',
      sessionsStoragePath: settingsPath + '/exchange1cSessions'
    };

    const loadedSettings: {[key: string]: unknown} = await (
      await new Firestore().doc(settingsPath).get()
    ).data()?.exchange1c ?? {};

    Object.entries(loadedSettings).forEach(([attributeName, value]) => {
      if (
        value !== undefined &&
        value !== null &&
        value !== ''
      ) {
        (settings as unknown as {[key: string]: unknown})[attributeName] = loadedSettings[attributeName];
      }
    });

    if (!settings.username || !settings.password) {
      throw new Error('1C exchange settings \'username\' and/or \'password\' not set');
    }

    return settings;
  }

  /**
   * Returns result as a plain text.
   * @override
   */
  protected async _returnResult(
    parameters: CloudFunctionExecutionParameters,
    result: string | {[key: string]: unknown} | void
  ): Promise<void> {
    console.log(JSON.stringify(result));
    if (parameters.trigger === 'HTTP') {
      parameters.response?.status(200).send(result);
    }
  }

  /**
   * Returns list of lines joined into one string with '\n' symbol.
   * @param lines
   */
  protected result(...lines: string[]): string {
    return lines.join('\n');
  }

  /**
   * Returns failure result.
   * @param message
   */
  protected failureResult(message?: string): string {
    console.error(message);
    return this.result('failure', message ?? '');
  }

  /**
   * Saves raw data to Cloud Storage.
   *
   * @param bucketName
   * @param folder
   * @param timestamp timestamp in JSON serialized format
   * @param fileName file name
   * @param data raw data from the request body
   */
  protected async saveToStorage(bucketName: string, folder: string, timestamp: string, fileName: string, data: Buffer): Promise<void> {
    const remotePath = posix.join(folder, timestamp ? timestamp + '_' + fileName : fileName);
    console.log('Uploading file to Google Cloud storage');
    await new Promise((resolve, reject) => {
      const writeStream = new Storage().bucket(bucketName).file(remotePath)
        .createWriteStream()
        .on('finish', () => resolve())
        .on('error', error => reject(error));

      const dataStream = new PassThrough();
      dataStream.end(data);
      dataStream.pipe(writeStream);
    });

    console.log(`Uploaded to: ${bucketName}/${remotePath}`);
  }

  /**
   * Extracts session info from the HTTP request.
   * @param request HTTP request.
   */
  protected async getRequestSessionInfo(request: Request): Promise<RequestSessionInfo> {
    console.log(`getRequestSessionInfo: request.headers=${JSON.stringify(request.headers)}, request.query=${JSON.stringify(request.query)}`);
    let sessionId = '';
    const cookieString = request.header('Cookie');
    if (cookieString) {
      const cookies = parse(cookieString);
      if (cookies) {
        sessionId = cookies[this.settings.sessionIdCookieName];
      }
    }

    return {
      sessionId,
      csrfToken: request.query.sessid ? request.query.sessid as string : ''
    };
  }

  /**
   * Extracts basic auth credentials from the HTTP request header.
   * @param request
   */
  protected getBasicCredentials(request: Request): BasicCredentials {
    const result = auth(request);
    return {
      username: result?.name ?? '',
      password: result?.pass ?? ''
    };
  }

  /**
   * Loads exchange session by id from storage.
   * @param sessionId Exchange session ID.
   */
  protected async loadSession(sessionId: string): Promise<ExchangeSession | undefined> {
    if (!sessionId) {
      return undefined;
    }

    const doc = await this.firestore.doc(this.settings.sessionsStoragePath + '/' + sessionId).get();
    if (!doc.exists) {
      return undefined;
    }

    const storedSession = doc.data() as ExchangeSessionStoredInFirestore;
    if (!storedSession || !storedSession.expirationTimestamp || storedSession.expirationTimestamp.toDate() <= DateTime.utc().toJSDate()) {
      await doc.ref.delete();
      return undefined;
    }

    return {
      sessionId: storedSession.sessionId,
      csrfToken: storedSession.csrfToken,
      expirationTimestamp: storedSession.expirationTimestamp.toDate()
    };
  }

  /**
   * Deletes all expired exchange sessions.
   */
  protected async deleteExpiredSessions(): Promise<void> {
    const querySnapshot = await this.firestore
      .collection(this.settings.sessionsStoragePath)
      .select('id')
      .where('expirationTimestamp', '<=', DateTime.utc().toJSDate())
      .get();

    if (querySnapshot.size === 0) {
      return;
    }

    const promises = [];
    for (const doc of querySnapshot.docs) {
      promises.push(doc.ref.delete());
    }

    await Promise.all(promises);
  }

  protected async saveSession(session: ExchangeSession): Promise<void> {
    await this.firestore.collection(this.settings.sessionsStoragePath).doc(session.sessionId).set(session);
  }

  /**
   * Validates exchange request.
   * @param requestSessionInfo Session information acquired from `checkauth`.
   */
  protected async validateRequestSessionInfo(requestSessionInfo: RequestSessionInfo): Promise<{success: boolean; error?: string}> {
    console.log(`validateRequestSessionInfo: ${JSON.stringify(requestSessionInfo)}`);
    const storedSession = await this.loadSession(requestSessionInfo.sessionId);
    if (!storedSession) {
      return {
        success: false,
        error: 'No active session found. Use \'mode=checkauth\' to start a new session.'
      };
    }

    if (this.settings.csrfProtection && requestSessionInfo.csrfToken !== storedSession.csrfToken) {
      return {
        success: false,
        error: 'Invalid CSRF token.'
      };
    }

    return {success: true};
  }

  /**
   * Step A.
   * @param credentials HTTP Auth Basic credentials
   */
  protected async checkauth(credentials: BasicCredentials): Promise<string> {
    if (credentials.username !== this.settings.username || credentials.password !== this.settings.password) {
      return this.failureResult('Unauthorized');
    }

    const session: ExchangeSession = {
      sessionId: uuidv4(),
      csrfToken: uuidv4(),
      expirationTimestamp: DateTime.utc().plus({seconds: this.exchangeSessionDurationSeconds}).toJSDate()
    };

    // Delete old sessions from the storage and save new one
    const promises: Array<Promise<void>> = [
      this.deleteExpiredSessions(),
      this.saveSession(session)
    ];
    await Promise.all(promises);

    return this.result(
      'success',
      this.settings.sessionIdCookieName,
      session.sessionId,
      `${this.settings.csrfTokenName}=${session.csrfToken}`,
      `timestamp=${Math.round(DateTime.utc().toSeconds())}`
    );
  }

  /**
   * Step B.
   */
  protected async init(): Promise<string> {
    return this.result(
      `zip=${this.settings.zip ? 'yes' : 'no'}`,
      `file_limit=${this.settings.fileSizeLimit}`
    );
  }

  /**
   * Step C.
   * @param filename
   * @param requestBody
   */
  protected async file(filename: string, requestBody: Buffer | undefined): Promise<string> {
    if (!filename) {
      return this.failureResult('Filename is empty.');
    }

    console.log(`filename: ${filename}`);

    if (!requestBody) {
      return this.failureResult('Request body is undefined');
    }

    if (filename.startsWith('import_files')) {
      await this.saveToStorage(
        '1c-exchange-files',
        posix.dirname(filename),
        '',
        posix.basename(filename),
        requestBody
      );
    } else {
      await this.saveToStorage(
        '1c-exchange-catalog',
        '',
        DateTime.utc().toFormat('yyyy-MM-dd_HH-mm-ss-SSSZZZ'),
        filename,
        requestBody
      );
    }

    return 'success';
  }

  /**
   * Step C. For reports.
   * @param filename
   * @param requestBody
   */
  protected async fileReport(filename: string, requestBody: Buffer | undefined): Promise<string> {
    if (!filename) {
      return this.failureResult('Filename is empty.');
    }

    console.log(`filename: ${filename}`);

    if (!requestBody) {
      return this.failureResult('Request body is undefined');
    }

    if (filename.startsWith('import_files')) {
      await this.saveToStorage(
        '1c-exchange-report',
        posix.dirname(filename),
        '',
        posix.basename(filename),
        requestBody
      );
    } else {
      await this.saveToStorage(
        '1c-exchange-report',
        '',
        '',
        filename,
        requestBody
      );
    }

    return 'success';
  }

  /**
   * Step D. Only for catalog XML files.
   * @param filename
   */
  protected async import(filename: string): Promise<string> {
    if (!filename) {
      return this.failureResult('Filename is empty.');
    }

    console.log(`filename: ${filename}`);

    return 'success';
  }

  protected async main(parameters: CloudFunctionExecutionParameters): Promise<string | { [p: string]: unknown } | void> {
    const {request} = parameters;
    if (!request) {
      throw new Error('Cloud Function parameters.request not set.');
    }

    // Supports only catalog exchange
    const type = request.query.type as string;
    console.log(`type: ${type}`);
    if (type !== 'catalog' && type !== 'report') {
      console.error(`Parameter type "${type}" is not supported. Supported parameters: catalog, report`);
      return this.failureResult(`Parameter type "${type}" is not supported. Supported parameters: catalog, report`);
    }

    const mode = request.query.mode as string;
    console.log(`mode: ${mode}`);

    // Step A
    if (mode === 'checkauth') {
      return this.checkauth(this.getBasicCredentials(request));
    }

    // Session validation
    const sessionValidation = await this.validateRequestSessionInfo(await this.getRequestSessionInfo(request));
    if (!sessionValidation.success) {
      return this.failureResult(sessionValidation.error);
    }

    // Ste B
    if (mode === 'init') {
      return this.init();
    }

    // Step C
    const filename = request.query.filename as string;
    if (mode === 'file') {
      if (type === 'catalog') {
        return this.file(filename, request.rawBody);
      }

      if (type === 'report') {
        return this.fileReport(filename, request.rawBody);
      }
    }

    // Step D
    if (mode === 'import') {
      return this.import(filename);
    }

    return this.failureResult(`Type '${type}' and mode '${mode}' are not supported.`);
  }
}
