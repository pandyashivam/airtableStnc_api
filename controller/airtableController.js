const airtableService = require('../services/airtable.service');
const SystemUser = require('../models/systemUser.model');
const BasesModel = require('../models/bases.model');
const TablesModel = require('../models/tables.model');
const UsersModel = require('../models/users.model');
const TicketsModel = require('../models/tickets.model');
const ParsedRevisionHistoryModel = require('../models/parsedRevisionHistory.model');
const mongoose = require('mongoose');

exports.syncAllData = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    const result = await airtableService.syncAllData(userId);
    
    res.status(200).json({
      status: 'success',
      message: 'All data synchronized successfully',
      result
    });
  } catch (error) {
    next(error);
  }
};

exports.getBases = async (req, res, next) => {
  try {
    const bases = await BasesModel.find();
    
    res.status(200).json({
      status: 'success',
      data: bases
    });
  } catch (error) {
    console.error('Error fetching bases:', error);
    next(error);
  }
};

exports.getTablesByBaseId = async (req, res, next) => {
  try {
    const { baseId } = req.params;
    
    if (!baseId) {
      return res.status(400).json({
        status: 'fail',
        message: 'Base ID is required'
      });
    }
    
    const tables = await TablesModel.find({ baseId });
    
    res.status(200).json({
      status: 'success',
      data: tables
    });
  } catch (error) {
    console.error('Error fetching tables:', error);
    next(error);
  }
};

exports.getModelData = async (req, res, next) => {
  try {
    const { modelName } = req.params;
    
    if (!modelName) {
      return res.status(400).json({
        status: 'fail',
        message: 'Model name is required'
      });
    }
    
    let Model;
    switch (modelName) {
      case 'Users':
        Model = UsersModel;
        break;
      case 'Tickets':
        Model = TicketsModel;
        break;
      default:
        return res.status(404).json({
          status: 'fail',
          message: `Model ${modelName} not found`
        });
    }
    
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;
    
    let sort = {};
    if (req.query.sortBy) {
      const sortField = req.query.sortBy;
      const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1;
      sort[sortField] = sortOrder;
    } else {
      if (modelName === 'Tickets') {
        sort = { 'Ticket ID': 1 };
      } else if (modelName === 'Users') {
        sort = { Email: 1};
      } else {
        sort = { createdAt: -1 };
      }
    }
    
    let query = {};
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      
      const schemaFields = Object.keys(Model.schema.paths).filter(
        field => !['_id', '__v', 'createdAt', 'updatedAt'].includes(field)
      );
      
      const searchConditions = schemaFields.map(field => {
        const condition = {};
        condition[field] = searchRegex;
        return condition;
      });
      
      query = { $or: searchConditions };
    }
    
    if (req.query.filterField && req.query.filterValue) {
      query[req.query.filterField] = req.query.filterValue;
    }
    
    const data = await Model.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();
    
    const totalCount = await Model.countDocuments(query);
    
    const populatedData = await Promise.all(
      data.map(async (item) => {
        const result = { ...item };
        
        if (modelName === 'Users' && item.Tickets && item.Tickets.length > 0) {
          const ticketDocs = await TicketsModel.find({ _airtableId: { $in: item.Tickets } }).lean();
          result.Tickets = ticketDocs;
        } else if (modelName === 'Tickets' && item['Assigned To'] && item['Assigned To'].length > 0) {
          const userDocs = await UsersModel.find({ _airtableId: { $in: item['Assigned To'] } }).lean();
          result['Assigned To'] = userDocs;
        }
        
        // Check if revision history exists for this record
        if (item._airtableId) {
          const revisionHistory = await ParsedRevisionHistoryModel.findOne({ recordId: item._airtableId }).lean();
          result.hasRevisionHistory = !!revisionHistory;
        }
        
        return result;
      })
    );
    
    const fields = extractFieldsFromData(populatedData);
    
    res.status(200).json({
      status: 'success',
      data: populatedData,
      fields,
      pagination: {
        total: totalCount,
        page,
        limit,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching model data:', error);
    next(error);
  }
};

exports.revisionHistorySync = async (req, res, next) => {
  try {
    const { email, password, mfaCode } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        status: 'fail',
        message: 'Email and password are required'
      });
    }
    
    const result = await airtableService.revisionHistorySync(email, password, mfaCode);
    
    res.status(200).json({
      status: 'success',
      message: 'Revision history synchronized successfully',
      data: result
    });
  } catch (error) {
    console.error('Error syncing revision history:', error);
    next(error);
  }
};

exports.getRevisionHistoryByRecordId = async (req, res, next) => {
  try {
    const { recordId } = req.params;
    
    if (!recordId) {
      return res.status(400).json({
        status: 'fail',
        message: 'Record ID is required'
      });
    }
    
    const revisionHistory = await ParsedRevisionHistoryModel.findOne({ recordId }).lean();
    
    if (!revisionHistory) {
      return res.status(404).json({
        status: 'fail',
        message: 'Revision history not found for this record'
      });
    }
    
    res.status(200).json({
      status: 'success',
      data: revisionHistory
    });
  } catch (error) {
    console.error('Error fetching revision history:', error);
    next(error);
  }
};

function extractFieldsFromData(documents) {
  const fieldMap = new Map();
  const excludeFields = ['_id', '__v', 'createdAt', 'updatedAt'];
  const excludePatterns = [
    'buffer', 'readUInt', 'readInt', 'readDouble', 'write', 'inspect', 'toJSON'
  ];

  function shouldExclude(fieldPath) {
    if (excludeFields.includes(fieldPath)) return true;
    return excludePatterns.some(pattern => fieldPath.includes(pattern));
  }

  if (documents && documents.length > 0) {
    const sampleDoc = documents[0];
    
    function extract(obj, parentKey = '') {
      for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
  
        const fullKey = parentKey ? `${parentKey}.${key}` : key;
        const value = obj[key];
  
        if (shouldExclude(fullKey)) continue;
  
        if (!fieldMap.has(fullKey)) {
          let type = 'string';
          
          if (Array.isArray(value)) {
            type = 'array';
            if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
              type = 'reference';
            }
          } else if (value instanceof Date) {
            type = 'date';
          } else if (Buffer.isBuffer(value)) {
            type = 'buffer';
          } else if (typeof value === 'number') {
            type = 'number';
          } else if (typeof value === 'boolean') {
            type = 'boolean';
          } else if (value === null) {
            type = 'null';
          } else if (typeof value === 'object') {
            type = 'object';
          }
          
          fieldMap.set(fullKey, {
            id: fullKey,
            name: key,
            type: type,
            options: {}
          });
        }
  
        if (value && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value)) {
          extract(value, fullKey);
        }
      }
    }
    
    extract(sampleDoc);
  }

  return Array.from(fieldMap.values());
}


