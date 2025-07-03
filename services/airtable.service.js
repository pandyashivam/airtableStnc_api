const axios = require('axios');
const mongoose = require('mongoose');
const querystring = require('querystring');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const SystemUser = require('../models/systemUser.model');
const BasesModel = require('../models/bases.model');
const TablesModel = require('../models/tables.model');
const UsersModel = require('../models/users.model');
const TicketsModel = require('../models/tickets.model');
const RawRevisionHistoryModel = require('../models/rawRevisionHistory.model');
const ParsedRevisionHistoryModel = require('../models/parsedRevisionHistory.model');

const AIRTABLE_TOKEN_URL = 'https://airtable.com/oauth2/v1/token';
const AIRTABLE_CLIENT_ID = process.env.AIRTABLE_CLIENT_ID;
const AIRTABLE_CLIENT_SECRET = process.env.AIRTABLE_CLIENT_SECRET;
const AIRTABLE_DOMAIN = 'https://airtable.com';

class AirtableService {
  constructor() {
    this.baseUrl = 'https://api.airtable.com/v0';
    this.metaUrl = 'https://api.airtable.com/v0/meta';
    this.browser = null;
  }

  async getAccessToken(userId) {
    const user = await SystemUser.findById(userId);
    
    if (!user || !user.airtableOAuth || !user.airtableOAuth.accessToken) {
      throw new Error('No Airtable access token available');
    }
    
    const now = new Date();
    if (user.airtableOAuth.expiresAt && new Date(user.airtableOAuth.expiresAt) <= now) {
      const accessToken = await this.getRefreshToken(userId);
      return accessToken;
    }
    
    return user.airtableOAuth.accessToken;
  }


  async getRefreshToken(userId) {
    try { 
      const user = await SystemUser.findById(userId);
      if (!user || !user.airtableOAuth?.refreshToken) {
        throw new Error('No refresh token available');
      }
  
      console.log('Attempting to refresh token with:', { 
        clientId: AIRTABLE_CLIENT_ID ? 'Set' : 'Not set', 
        clientSecret: AIRTABLE_CLIENT_SECRET ? 'Set' : 'Not set',
        refreshToken: user.airtableOAuth.refreshToken ? 'Set' : 'Not set',
        tokenUrl: AIRTABLE_TOKEN_URL
      });
      
      const requestBody = {
        refresh_token: user.airtableOAuth.refreshToken,
        grant_type: 'refresh_token'
      };
      
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded'
      };
      
      if (AIRTABLE_CLIENT_SECRET) {
        const credentials = Buffer.from(`${AIRTABLE_CLIENT_ID}:${AIRTABLE_CLIENT_SECRET}`).toString('base64');
        headers['Authorization'] = `Basic ${credentials}`;
      } else if (AIRTABLE_CLIENT_ID) {
        requestBody.client_id = AIRTABLE_CLIENT_ID;
      }
      
      const tokenResponse = await axios.post(
        AIRTABLE_TOKEN_URL,
        querystring.stringify(requestBody),
        { headers }
      );
  
      const {
        access_token,
        refresh_token,
        expires_in
      } = tokenResponse.data;
  
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + expires_in);
  
      user.airtableOAuth.accessToken = access_token;
      if (refresh_token) {
        user.airtableOAuth.refreshToken = refresh_token;
      }
      user.airtableOAuth.expiresAt = expiresAt;
      await user.save();
  
      return access_token;
    } catch (error) {
      console.error('Airtable token refresh error:', error.response?.data || error.message);
      console.error('Error details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        url: error.config?.url,
        method: error.config?.method,
        headers: error.config?.headers
      });
      
      if (error.response) {
        const status = error.response.status;
        
        if (status === 409) {
          console.warn('Conflict error: Token was recently refreshed. Using existing token.');
          return user.airtableOAuth.accessToken;
        } else if (status === 429) {
          console.warn('Rate limit exceeded. Please try again later.');
          throw new Error('Airtable rate limit exceeded. Please try again later.');
        } else if (status === 401) {
          console.warn('Unauthorized: Refresh token may be expired or invalid.');
          user.airtableOAuth.refreshToken = null;
          user.airtableOAuth.accessToken = null;
          await user.save();
          throw new Error('Airtable refresh token expired. Please reauthorize.');
        }
      }
      
      throw error;
    }
  };

  async getBases(userId) {
    const accessToken = await this.getAccessToken(userId);
    
    try {
      const response = await axios.get(`${this.metaUrl}/bases`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      return response.data.bases || [];
    } catch (error) {
      console.error('Error fetching bases:', error.response?.data || error.message);
      throw error;
    }
  }

  async getTables(userId, baseId) {
    const accessToken = await this.getAccessToken(userId);
    
    try {
      const response = await axios.get(`${this.metaUrl}/bases/${baseId}/tables`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      return response.data.tables || [];
    } catch (error) {
      console.error('Error fetching tables:', error.response?.data || error.message);
      throw error;
    }
  }

  async getRecords(userId, baseId, tableId, options = {}) {
    const accessToken = await this.getAccessToken(userId);
    
    try {
      const queryParams = new URLSearchParams();
      
      if (options.pageSize) queryParams.append('pageSize', options.pageSize);
      if (options.offset) queryParams.append('offset', options.offset);
      if (options.view) queryParams.append('view', options.view);
      
      const url = `${this.baseUrl}/${baseId}/${tableId}?${queryParams.toString()}`;
      
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      return {
        records: response.data.records || [],
        offset: response.data.offset
      };
    } catch (error) {
      console.error('Error fetching records:', error.response?.data || error.message);
      throw error;
    }
  }

  async getAllRecords(userId, baseId, tableId, options = {}) {
    let allRecords = [];
    let offset = null;
    
    do {
      const paginationOptions = { ...options };
      if (offset) paginationOptions.offset = offset;
      
      const result = await this.getRecords(userId, baseId, tableId, paginationOptions);
      
      allRecords = [...allRecords, ...result.records];
      offset = result.offset;
    } while (offset);
    
    return allRecords;
  }

  async insertBaseData(baseData) {
    try {
      const baseDoc = {
        _airtableId: baseData.id,
        name: baseData.name
      };
      
      await BasesModel.updateOne(
        { _airtableId: baseData.id },
        { $set: baseDoc },
        { upsert: true }
      );
      
      console.log(`Base data inserted/updated for: ${baseData.name}`);
      return true;
    } catch (error) {
      console.error('Error inserting base data:', error);
      throw error;
    }
  }
  
  async insertTableData(tableData, baseId) {
    try {
      const tableDoc = {
        _airtableId: tableData.id,
        name: tableData.name,
        fields: tableData.fields,
        baseId: baseId
      };
      
      await TablesModel.updateOne(
        { _airtableId: tableData.id },
        { $set: tableDoc },
        { upsert: true }
      );
      
      console.log(`Table data inserted/updated for: ${tableData.name}`);
      return true;
    } catch (error) {
      console.error('Error inserting table data:', error);
      throw error;
    }
  }

  async syncAllData(userId) {
    try {
      // Check if data already exists in Users and Tickets collections
      const userCount = await UsersModel.countDocuments();
      const ticketCount = await TicketsModel.countDocuments();
      
      if (userCount > 0 && ticketCount > 0) {
        console.log('Data already exists in Users and Tickets collections, skipping sync');
        return { success: true, message: 'Data already exists, sync skipped' };
      }
      
      const bases = await this.getBases(userId);

      for (const base of bases) {
        await this.insertBaseData(base);

        const tables = await this.getTables(userId, base.id);
        
        for (const table of tables) {
          await this.insertTableData(table, base.id);
        }

        for (const table of tables) {
          const records = await this.getAllRecords(userId, base.id, table.id);
          
          if (table.name === 'Users') {
            await this.insertUserRecords(records);
          } else if (table.name === 'Tickets') {
            await this.insertTicketRecords(records);
          }
        }
      }
      
      return { success: true, message: 'All data synchronized successfully' };
    } catch (error) {
      console.error('Error syncing all data:', error);
      throw error;
    }
  }

  async insertUserRecords(records) {
    const documents = [];
    
    for (const record of records) {
      const doc = {
        _airtableId: record.id,
        Name: record.fields.Name,
        Email: record.fields.Email,
        Tickets: record.fields.Tickets || [],
        createdTime: new Date(record.createdTime)
      };
      
      documents.push(doc);
    }
    
    const bulkOps = documents.map(doc => ({
      updateOne: {
        filter: { _airtableId: doc._airtableId },
        update: { $set: doc },
        upsert: true
      }
    }));
    
    if (bulkOps.length > 0) {
      await UsersModel.bulkWrite(bulkOps);
      console.log(`Processed ${bulkOps.length} User records`);
    }
  }

  async insertTicketRecords(records) {
    const documents = [];
    
    for (const record of records) {
      const doc = {
        _airtableId: record.id,
        'Ticket ID': record.fields['Ticket ID'],
        Title: record.fields.Title,
        Description: record.fields.Description,
        Status: record.fields.Status,
        'Assigned To': record.fields['Assigned To'] || [],
        createdTime: new Date(record.createdTime)
      };
      
      documents.push(doc);
    }
    
    const bulkOps = documents.map(doc => ({
      updateOne: {
        filter: { _airtableId: doc._airtableId },
        update: { $set: doc },
        upsert: true
      }
    }));
    
    if (bulkOps.length > 0) {
      await TicketsModel.bulkWrite(bulkOps);
      console.log(`Processed ${bulkOps.length} Ticket records`);
    }
  }

  camelCase(str) {
    return str
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) =>
        index === 0 ? word.toLowerCase() : word.toUpperCase()
      )
      .replace(/\s+/g, '');
  }
  
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
  
  async revisionHistorySync(email, password, mfaCode = null) {
    try {
      console.log('Starting revision history sync process...');
  
      const bases = await BasesModel.find().lean();
      if (!bases || bases.length === 0) {
        throw new Error('No bases found');
      }
  
      const urls = [];
      const limit = 20000;
      let urlCount = 0;
  
      for (const base of bases) {
        const baseId = base._airtableId;
  
        const tables = await TablesModel.find({ baseId }).lean();
  
        for (const table of tables) {
          const tableId = table._airtableId;
          const tableName = table.name;
  
          let Model;
          let sortField;
          switch (tableName) {
            case 'Tickets':
              Model = TicketsModel;
              sortField = 'Ticket ID';
              break;
            case 'Users':
              Model = UsersModel;
              sortField = 'Email';
              break;
            default:
              console.log(`No model found for table: ${tableName}`);
              continue;
          }
  
          const records = await Model.find().sort({ [sortField]: 1 }).lean();
  
          for (const record of records) {
            if (urlCount >= limit) break;
  
            const recordId = record._airtableId;
            if (!recordId) continue;
  
            urls.push({
              recordId,
              tableName,
              modelId: record._id,
              baseId,
              tableId
            });
  
            urlCount++;
          }
  
          if (urlCount >= limit) break;
        }
  
        if (urlCount >= limit) break;
      }
  
      console.log(`Generated ${urls.length} URLs for revision history sync`);
  
      // Launch browser for login only
      console.log('Launching browser for Airtable login...');
      const browser = await puppeteer.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ],
        defaultViewport: null
      });
  
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setDefaultTimeout(30000);
  
      console.log('Navigating to Airtable login page...');
      await page.goto('https://airtable.com/login', { waitUntil: 'networkidle2' });
  
      console.log('Entering email...');
      await page.waitForSelector('input[type="email"]');
      await page.type('input[type="email"]', email);
      await page.click('button[type="submit"]');
  
      console.log('Entering password...');
      await page.waitForSelector('input[type="password"]', { timeout: 5000 });
      await page.type('input[type="password"]', password);
      await page.click('button[type="submit"]');
  
      if (mfaCode) {
        try {
          console.log('Attempting to enter MFA code...');
          await page.waitForSelector('input[name="otp"]', { timeout: 3000 });
          await page.type('input[name="otp"]', mfaCode);
          await page.click('button[type="submit"]');
        } catch (e) {
          console.log('MFA prompt not found — skipping');
        }
      }
  
      console.log('Waiting for successful login...');
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      console.log('Login successful');
  
      // Extract cookies after successful login
      const cookies = await page.cookies();
      console.log(`Found ${cookies.length} cookies after login`);
      
      // Log all cookie names to help with debugging
      console.log('Cookie names:', cookies.map(c => c.name).join(', '));
      
      // Get all request headers from a real browser session
      const headers = await page.evaluate(() => {
        const result = {};
        const req = new XMLHttpRequest();
        req.open('GET', document.location.href, false);
        req.send(null);
        const headerString = req.getAllResponseHeaders();
        const headerPairs = headerString.split('\r\n');
        for (let i = 0; i < headerPairs.length; i++) {
          const pair = headerPairs[i].split(': ');
          if (pair[0]) {
            result[pair[0]] = pair[1];
          }
        }
        return result;
      });
      
      console.log('Headers from browser session:', JSON.stringify(headers));
      
      const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
      console.log('Extracted cookies from browser session');
      
      // Close browser as we don't need it anymore
      await browser.close();
      
      const results = [];
      let cookiesValid = true;
      
      // Function to check if cookies are valid and refresh them if needed
      const ensureValidCookies = async () => {
        if (!cookiesValid) {
          console.log('Cookies expired, re-logging in...');
          // Re-login and get fresh cookies
          const browser = await puppeteer.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
          });
          
          const page = await browser.newPage();
          await page.setViewport({ width: 1280, height: 800 });
          await page.setDefaultTimeout(30000);
          
          await page.goto('https://airtable.com/login', { waitUntil: 'networkidle2' });
          await page.waitForSelector('input[type="email"]');
          await page.type('input[type="email"]', email);
          await page.click('button[type="submit"]');
          
          await page.waitForSelector('input[type="password"]', { timeout: 5000 });
          await page.type('input[type="password"]', password);
          await page.click('button[type="submit"]');
          
          if (mfaCode) {
            try {
              await page.waitForSelector('input[name="otp"]', { timeout: 3000 });
              await page.type('input[name="otp"]', mfaCode);
              await page.click('button[type="submit"]');
            } catch (e) {
              console.log('MFA prompt not found — skipping');
            }
          }
          
          await page.waitForNavigation({ waitUntil: 'networkidle2' });
          
                     const freshCookies = await page.cookies();
           const newCookieString = freshCookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
           cookieString = newCookieString;
           console.log('Refreshed cookies from browser session');
          
          await browser.close();
          cookiesValid = true;
        }
      };
  
      for (const [index, urlData] of urls.entries()) {
        await ensureValidCookies();
        
        console.log(`Processing record ${index + 1}/${urls.length}: ${urlData.recordId}`);
  
        try {
          // Construct the API endpoint URL - exactly matching the Airtable frontend request
          const apiUrl = `https://airtable.com/v0.3/row/${urlData.recordId}/readRowActivitiesAndComments`;
          
          // Use fixed values for requestId and secretSocketId to match exactly what Airtable frontend sends
          const params = {
            stringifiedObjectParams: JSON.stringify({
              limit: 10,
              offsetV2: null,
              shouldReturnDeserializedActivityItems: true,
              shouldIncludeRowActivityOrCommentUserObjById: true
            }),
            requestId: 'reqvpDYcHmA6QI6YP',
            secretSocketId: 'socgIkar6j282ik8e'
          };
          
          const queryString = querystring.stringify(params);
          const fullUrl = `${apiUrl}?${queryString}`;
          
          // Log the URL and cookies before making the request
          console.log(`Making request to: ${fullUrl}`);
          console.log(`Using cookies: ${cookieString.substring(0, 50)}...`);
          
          // Make the API request using axios with cookies - exactly matching Airtable's frontend headers
          const pageLoadId = `pgl${Math.random().toString(36).substring(2, 15)}`;
          const traceId = Math.random().toString(16).substring(2, 34);
          const spanId = Math.random().toString(16).substring(2, 18);
          
          const response = await axios.get(fullUrl, {
            headers: {
              'Cookie': cookieString,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
              'Accept': 'application/json, text/javascript, */*; q=0.01',
              'Referer': `https://airtable.com/${urlData.baseId}/${urlData.tableId}/viwY85shOwug5YT4C/${urlData.recordId}?blocks=hide`,
              'X-Requested-With': 'XMLHttpRequest',
              'x-airtable-application-id': urlData.baseId,
              'x-airtable-page-load-id': pageLoadId,
              'x-airtable-inter-service-client': 'webClient',
              'x-airtable-inter-service-client-code-version': '2b0c6c84990d91f0ce4fb60da616221a79defaec',
              'x-airtable-client-queue-time': '5518.699999999255',
              'x-time-zone': 'Asia/Calcutta',
              'x-user-locale': 'en',
              'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
              'sec-ch-ua-mobile': '?0',
              'sec-ch-ua-platform': '"Windows"',
              'traceparent': `00-${traceId}-${spanId}-01`,
              'tracestate': ''
            },
            withCredentials: true
          });
          
          const revisionData = response.data;
          
          // Save raw revision data
          await RawRevisionHistoryModel.updateOne(
            {
              recordId: urlData.recordId,
              baseId: urlData.baseId,
              tableId: urlData.tableId
            },
            {
              $set: {
                recordId: urlData.recordId,
                baseId: urlData.baseId,
                tableId: urlData.tableId,
                tableName: urlData.tableName,
                revisionData: revisionData,
                updatedAt: new Date()
              }
            },
            { upsert: true }
          );
  
          // Parse and save revision items
          if (revisionData.data && revisionData.data.rowActivityInfoById) {
            const parsedRevisionItems = [];
  
            for (const [activityId, activityData] of Object.entries(revisionData.data.rowActivityInfoById)) {
              if (activityData.diffRowHtml) {
                const parsedChange = this.parseHtmlChange(activityData.diffRowHtml, {
                  activityID: activityId,
                  ticketId: urlData.recordId,
                  createdTime: activityData.createdTime,
                  originationguserId: activityData.originatingUserId
                });
  
                if (parsedChange) {
                  parsedRevisionItems.push(parsedChange);
                }
              }
            }
  
            if (parsedRevisionItems.length > 0) {
              await ParsedRevisionHistoryModel.updateOne(
                {
                  recordId: urlData.recordId,
                  baseId: urlData.baseId,
                  tableId: urlData.tableId
                },
                {
                  $set: {
                    recordId: urlData.recordId,
                    baseId: urlData.baseId,
                    tableId: urlData.tableId,
                    tableName: urlData.tableName,
                    revisionData: parsedRevisionItems,
                    updatedAt: new Date()
                  }
                },
                { upsert: true }
              );
  
              console.log(`Saved ${parsedRevisionItems.length} parsed revision items for record: ${urlData.recordId}`);
            }
          }
          
          results.push({
            recordId: urlData.recordId,
            tableName: urlData.tableName,
            success: true
          });
        } catch (error) {
          console.error(`Error fetching revision data for record ${urlData.recordId}:`, error.message);
          
          // Log detailed error information
          if (error.response) {
            console.error('Error response status:', error.response.status);
            console.error('Error response headers:', JSON.stringify(error.response.headers));
            console.error('Error response data:', JSON.stringify(error.response.data));
            console.error('Request URL:', fullUrl);
            console.error('Request headers:', JSON.stringify(error.config.headers));
          }
          
          // Check if the error is due to invalid cookies
          if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            console.log('Cookies appear to be expired or invalid, will refresh on next iteration');
            cookiesValid = false;
            
            // Add to results as failed
            results.push({
              recordId: urlData.recordId,
              tableName: urlData.tableName,
              success: false,
              error: 'Authentication error - cookies expired'
            });
          } else {
            results.push({
              recordId: urlData.recordId,
              tableName: urlData.tableName,
              success: false,
              error: error.message
            });
          }
        }
        
        // Add a small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
  
      return {
        success: true,
        processedRecords: results.length,
        successfulRecords: results.filter(r => r.success).length,
        failedRecords: results.filter(r => !r.success).length,
        results
      };
    } catch (error) {
      console.error('Error in revision history sync:', error);
      throw error;
    }
  }
  

  parseHtmlChange(html, activityData) {
    const $ = cheerio.load(html);
  
    const columnType = $('.historicalCellContainer > div')
      .first()
      .text()
      .trim();
  
    let oldValue = '';
    const strikethroughText = $('.strikethrough').text().trim();
    const removedRecord = $('.foreignRecord.removed').text().trim();
    const oldStatus = $('span[style*="text-decoration:line-through"]').text().trim();
    oldValue = strikethroughText || removedRecord || oldStatus || '';
  
    let newValue = '';
    const successText = $('.colors-background-success').text().trim();
    const addedRecord = $('.foreignRecord.added').text().trim();
    const newStatus = $('div[style*="background-color:var(--palette-green-greenLight1)"]').first().prev().find('div[title]').text().trim();
    const greenHighlightText = $('[style*="greenLight1"]').first().find('div[title]').text().trim();
  
    newValue = successText || addedRecord || newStatus || greenHighlightText || '';
  
    return {
      uuid: activityData.activityID,
      issueId: activityData.ticketId,
      columnType: columnType,
      oldValue: oldValue,
      newValue: newValue,
      createdDate: new Date(activityData.createdTime),
      authoredBy: activityData.originationguserId,
    };
  }
}


module.exports = new AirtableService(); 