/* eslint-disable max-len */
/* eslint-disable camelcase */
const { readFile } = require('fs').promises;
// eslint-disable-next-line no-unused-vars
const Client = require('.');
const Endpoints = require('../../resources/Endpoints');
const Tokens = require('../../resources/Tokens');

class Authenticator {
  /**
   * @param {Client} client Main client
   */
  constructor(client) {
    this.Client = client;

    this.auths = {
      token: undefined,
      expires_at: undefined,
    };

    this.reauths = {
      token: undefined,
      expires_at: undefined,
    };

    this.account = {
      id: undefined,
      displayName: undefined,
    };

    this.isRefreshing = false;
  }

  async authenticate() {
    this.Client.debug('Authenticating...');
    const startAuth = new Date().getTime();

    let auth;
    const authCreds = this.Client.config.auth;

    if (authCreds.deviceAuth) {
      auth = await this.deviceAuthAuthenticate(authCreds.deviceAuth);
    } else if (authCreds.exchangeCode) {
      auth = await this.exchangeCodeAuthenticate(authCreds.exchangeCode);
    } else if (authCreds.authorizationCode) {
      auth = await this.authorizationCodeAuthenticate(authCreds.authorizationCode);
    } else if (authCreds.refreshToken) {
      auth = await this.refreshTokenAuthenticate(authCreds.refreshToken);
    } else {
      return { success: false, response: 'No valid auth method found! Please provide one in the client config' };
    }

    if (!auth.success) return auth;

    if (!authCreds.deviceAuth && this.Client.listenerCount('deviceauth:created') > 0) {
      const deviceauth = await this.generateDeviceAuth(auth.response);
      if (deviceauth.success) {
        const deviceAuth = { accountId: deviceauth.response.accountId, deviceId: deviceauth.response.deviceId, secret: deviceauth.response.secret };
        this.Client.emit('deviceauth:created', deviceAuth);
        this.Client.config.auth.deviceAuth = deviceAuth;
      } else this.Client.debug(`Couldn't create device auth: ${deviceauth.response}`);
    }

    this.auths = {
      token: auth.response.access_token,
      expires_at: auth.response.expires_at,
    };

    this.reauths = {
      token: auth.response.refresh_token,
      expires_at: auth.response.refresh_expires_at,
    };

    this.account = {
      id: auth.response.account_id,
      displayName: auth.response.displayName,
    };

    await this.Client.Http.send(false, 'DELETE', `${Endpoints.OAUTH_TOKEN_KILL_MULTIPLE}?killType=OTHERS_ACCOUNT_CLIENT_SERVICE`, `bearer ${this.auths.token}`);

    if (this.Client.config.auth.checkEULA) {
      const EULAstatus = await this.acceptEULA();
      if (!EULAstatus.success) this.Client.debug('EULA checking failed!');
      if (EULAstatus.response.alreadyAccepted === false) this.Client.debug('Successfully accepted the EULA!');
    }

    this.Client.debug(`Authentification successful (${((Date.now() - startAuth) / 1000).toFixed(2)}s)`);
    return auth;
  }

  async refreshToken(forceVerify = false) {
    let tokenIsValid = true;

    if (forceVerify) {
      const tokenCheck = await this.Client.Http.send(false, 'GET', Endpoints.OAUTH_TOKEN_VERIFY, `bearer ${this.auths.token}`);
      if (tokenCheck.response.errorCode === 'errors.com.epicgames.common.oauth.invalid_token') tokenIsValid = false;
    }

    if (tokenIsValid) {
      const tokenExpires = new Date(this.auths.expires_at).getTime();
      if (tokenExpires < (Date.now() + 1000 * 60 * 10)) tokenIsValid = false;
    }

    if (!tokenIsValid) {
      const reAuth = await this.reauthenticate();
      if (!reAuth.success) return reAuth;
    }

    return { success: true };
  }

  async reauthenticate() {
    this.Client.debug('Reauthenticating...');
    const startAuth = new Date().getTime();

    let auth;
    if (this.Client.config.auth.deviceAuth) auth = await this.deviceAuthAuthenticate(this.Client.config.auth.deviceAuth);
    else auth = this.getOauthToken('refresh_token', { refresh_token: this.reauths.token });

    if (!auth.success) return auth;

    this.auths = {
      token: auth.response.access_token,
      expires_at: auth.response.expires_at,
    };

    this.reauths = {
      token: auth.response.refresh_token,
      expires_at: auth.response.refresh_expires_at,
    };

    this.account = {
      id: auth.response.account_id,
      displayName: auth.response.displayName,
    };

    this.Client.debug(`Reauthentification successful (${((Date.now() - startAuth) / 1000).toFixed(2)}s)`);
    return { success: true };
  }

  async deviceAuthAuthenticate(deviceAuth) {
    let parsedDeviceAuth;

    switch (typeof deviceAuth) {
      case 'function': parsedDeviceAuth = await deviceAuth(); break;
      case 'string': try {
        parsedDeviceAuth = JSON.parse(await readFile(deviceAuth));
      } catch (err) {
        return { success: false, response: `The file ${deviceAuth} is not existing or formatted incorrectly` };
      } break;
      case 'object': parsedDeviceAuth = deviceAuth; break;
      default: return { success: false, response: `${typeof deviceAuth} is not a valid deviceAuth type` };
    }

    const authFormData = {
      account_id: parsedDeviceAuth.accountId || parsedDeviceAuth.account_id,
      device_id: parsedDeviceAuth.deviceId || parsedDeviceAuth.device_id,
      secret: parsedDeviceAuth.secret,
    };

    return this.getOauthToken('device_auth', authFormData, Tokens.FORTNITE_IOS);
  }

  async exchangeCodeAuthenticate(exchangeCode, token = Tokens.FORTNITE_IOS) {
    let parsedExchangeCode;

    switch (typeof exchangeCode) {
      case 'function': parsedExchangeCode = await exchangeCode(); break;
      case 'string': if (exchangeCode.endsWith('.json')) {
        try {
          parsedExchangeCode = JSON.parse(await readFile(exchangeCode));
        } catch (err) {
          return { success: false, response: `The file ${exchangeCode} is not existing or formatted incorrectly` };
        }
      } else {
        parsedExchangeCode = exchangeCode; break;
      } break;
      default: return { success: false, response: `${typeof exchangeCode} is not a valid exchangeCode type` };
    }

    return this.getOauthToken('exchange_code', { exchange_code: parsedExchangeCode }, token);
  }

  async authorizationCodeAuthenticate(authorizationCode) {
    let parsedAuthorizationCode;

    switch (typeof authorizationCode) {
      case 'function': parsedAuthorizationCode = await authorizationCode(); break;
      case 'string': if (authorizationCode.endsWith('.json')) {
        try {
          parsedAuthorizationCode = JSON.parse(await readFile(authorizationCode));
        } catch (err) {
          return { success: false, response: `The file ${authorizationCode} is not existing or formatted incorrectly` };
        }
      } else {
        parsedAuthorizationCode = authorizationCode; break;
      } break;
      default: return { success: false, response: `${typeof authorizationCode} is not a valid authorizationCode type` };
    }

    return this.getOauthToken('authorization_code', { code: parsedAuthorizationCode }, Tokens.FORTNITE_IOS);
  }

  async refreshTokenAuthenticate(refreshToken) {
    let parsedRefreshToken;

    switch (typeof refreshToken) {
      case 'function': parsedRefreshToken = await refreshToken(); break;
      case 'string': if (refreshToken.endsWith('.json')) {
        try {
          parsedRefreshToken = JSON.parse(await readFile(refreshToken));
        } catch (err) {
          return { success: false, response: `The file ${refreshToken} is not existing or formatted incorrectly` };
        }
      } else {
        parsedRefreshToken = refreshToken; break;
      } break;
      default: return { success: false, response: `${typeof refreshToken} is not a valid authorizationCode type` };
    }

    return this.getOauthToken('refresh_token', { refresh_token: parsedRefreshToken }, Tokens.FORTNITE_IOS);
  }

  async getOauthToken(grant_type, valuePair, token) {
    const formData = {
      grant_type,
      // token_type: 'eg1',
      ...valuePair,
    };

    return this.Client.Http.send(false, 'POST', Endpoints.OAUTH_TOKEN_CREATE, `basic ${token}`, { 'Content-Type': 'application/x-www-form-urlencoded' }, null, formData);
  }

  async generateDeviceAuth(tokenResponse) {
    return this.Client.Http.send(true, 'POST', `${Endpoints.OAUTH_DEVICE_AUTH}/${tokenResponse.account_id}/deviceAuth`,
      `bearer ${tokenResponse.access_token}`);
  }

  async acceptEULA() {
    const EULAdata = await this.Client.Http.send(false, 'GET', `${Endpoints.INIT_EULA}/account/${this.account.id}`, `bearer ${this.auths.token}`);
    if (!EULAdata.success) return EULAdata;
    if (!EULAdata.response) return { success: true, response: { alreadyAccepted: true } };

    const EULAaccepted = await this.Client.Http.send(false, 'POST',
      `${Endpoints.INIT_EULA}/version/${EULAdata.response.version}/account/${this.account.id}/accept?locale=${EULAdata.response.locale}`, `bearer ${this.auths.token}`);
    if (!EULAaccepted.success) return EULAaccepted;

    const FortniteAccess = await this.Client.Http.send(false, 'POST',
      `${Endpoints.INIT_GRANTACCESS}/${this.account.id}`, `bearer ${this.auths.token}`);
    if (!FortniteAccess.success) return FortniteAccess;

    return { success: true, response: { alreadyAccepted: false } };
  }
}

module.exports = Authenticator;
