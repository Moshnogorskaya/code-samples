const OAuthClient = require('intuit-oauth');
const config = require('config');
const User = require('../user/user.model');
const axios = require('axios');

const customSetToken = (client, tokenData) => {
  client.token = Object.assign(client.token || client.getToken().getToken(), tokenData);
  return client.token;
};

const oauthClient = new OAuthClient({
  clientId: config.quickbooks.clientId,
  clientSecret: config.quickbooks.clientSecret,
  environment: config.quickbooks.environment,
  redirectUri: `${config.superlogin.siteURL}/accounting/loading`,
});

const QBUrl = oauthClient.environment === 'sandbox' ? OAuthClient.environment.sandbox : OAuthClient.environment.production;
const couch = config.superlogin;
const couchdbAdminUrl = `${couch.dbServer.protocol}${couch.dbServer.user}:${couch.dbServer.password}@${couch.dbServer.host}`;

const getAuthURI = () => {
  const authUri = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state: 'testState',
  });

  return authUri;
};

const callback = async (req) => {
  try {
    const currUser = User.getLoggedUser(req.headers);
    const authResponse = oauthClient.createToken(req.url);
    const [{ _id }, { token }] = await Promise.all([currUser, authResponse]);
    await User.update({ _id, quickbooks: token, QBID: token.realmId }, req.headers);

    return true;
  } catch (e) {
    return new Error(e.message);
  }
};

const checkRefreshToken = async (headers) => {
  try {
    const { quickbooks: token } = await User.getRawUser(headers);
    if (token && token.x_refresh_token_expires_in > Date.now()) return true;

    return new Error('Quickbooks is not connected');
  } catch (e) {
    return new Error(e.message);
  }
};

const getUserToken = async (headers) => {
  const { _id, quickbooks } = await User.getRawUser(headers);

  return { _id, quickbooks };
};

const setValidToken = async (currentToken, userID, headers) => {
  customSetToken(oauthClient, currentToken);
  if (!oauthClient.isAccessTokenValid()) {
    await oauthClient.refresh();
    const token = oauthClient.getToken().getToken();
    token.realmId = token.realmId || currentToken.realmId;
    await User.update({ _id: userID, quickbooks: token }, headers);
  }
};

const revokeAccess = async (headers) => {
  try {
    const userToken = await getUserToken(headers);
    await setValidToken(userToken.quickbooks, userToken._id, headers);
    await oauthClient.revoke(oauthClient.getToken().getToken());
    await User.update({ _id: userToken._id, quickbooks: {}, QBID: '' }, headers);

    return true;
  } catch (e) {
    return new Error(e.message);
  }
};

const getDataFromQuickbooks = async (headers, reqUrl) => {
  try {
    const userToken = await getUserToken(headers);
    await setValidToken(userToken.quickbooks, userToken._id, headers);
    const { realmId } = userToken.quickbooks;
    const { body } = await oauthClient.makeApiCall({ url: `${QBUrl}v3/company/${realmId}${reqUrl}` });

    return JSON.parse(body);
    // return JSON.parse(body).QueryResponse;
  } catch (e) {
    return new Error(e.message);
  }
};

const makePostApiCall = (url, body) => {
  const request = {
    url,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${oauthClient.getToken().access_token}`,
      Accept: 'application/json',
      'User-Agent': OAuthClient.user_agent,
    },
    body,
  };

  return oauthClient.loadResponse(request);
};

const saveCollection = async (headers, collection, colName, collectionUrl) => {
  try {
    // Set users token to client
    const userToken = await getUserToken(headers);
    await setValidToken(userToken.quickbooks, userToken._id, headers);

    // Query parameters for QB
    const { realmId } = userToken.quickbooks;

    // If need to save an Item, have to get and include Account details
    let accountNameList;

    if (colName === 'Item') {
      const query = "select * from Account where AccountType = 'Cost of Goods Sold'";
      accountNameList = await oauthClient.makeApiCall({ url: `${QBUrl}v3/company/${realmId}/query?query=${query}` });
    }
    const parsed = [];
    // Edit only one item at a time
    for (const item of collection) {
      if (colName === 'Item') {
        const { Name, Id } = JSON.parse(accountNameList.body).QueryResponse.Account[0];
        item.ExpenseAccountRef = { name: Name, value: Id };
      }
      const result = await makePostApiCall(`${QBUrl}v3/company/${realmId}/${collectionUrl}`, item);
      const info = JSON.parse(result.body)[colName];

      if (info) {
        parsed.push({
          name: info.DisplayName || info.Name,
          quickbooksId: info.Id,
        });
      }
    }

    return parsed;
  } catch (e) {
    return new Error(e.message);
  }
};

const handleEvents = (events, token, user) => {
  events.forEach((event) => {
    if (event.name === 'Invoice' && event.operation === 'Create') {
      handleEstimateToInvoice(event, token, user);
    }

    if (event.name === 'Payment' && event.operation === 'Create') {
      handleInvoiceToPayment(event, token, user);
    }

    if (event.name === 'Bill' && event.operation === 'Create') {
      handlePOToBill(event, token, user);
    }

    if (event.name === 'BillPayment' && event.operation === 'Create') {
      handleBillToPayment(event, token, user);
    }
  });
};

const handleEventNotification = async (headers, body) => {
  try {
    const events = body.eventNotifications;

    // Get additional info about changed entities
    for (const event of events) {
      // Get token for request
      const usersFromDb = await axios
        .get(`${couchdbAdminUrl}/cibos-users/_design/cibos/_view/by_quickbooks?key="${event.realmId}"`);
      const users = usersFromDb.data.rows;
      const connectedUser = users.find((user) => {
        const token = user.value.quickbooks;
        return token
          && token.x_refresh_token_expires_in > Date.now()
          && event.realmId === user.value.QBID;
      });

      if (!connectedUser) return true;
      const user = connectedUser.value;
      let currentToken = user.quickbooks;
      customSetToken(oauthClient, currentToken);
      // Refresh token if expired
      if (oauthClient.isAccessTokenValid()) {
        await oauthClient.refresh();
        currentToken = await oauthClient.getToken().getToken();
        currentToken.realmId = currentToken.realmId || user.quickbooks.realmId;
        user.quickbooks = currentToken;
        await axios.put(`${couchdbAdminUrl}/cibos-users/${user._id}`, user);
      }
      handleEvents(event.dataChangeEvent.entities, currentToken, user);
    }

    return true;
  } catch (e) {
    return new Error(e.message);
  }
};

module.exports = {
  getAuthURI,
  callback,
  checkRefreshToken,
  revokeAccess,
  handleEventNotification,
};
