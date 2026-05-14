'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const AUCTION_HOST   = process.env.AUCTION_GRPC_HOST   || 'localhost:5001';
const INVENTORY_HOST = process.env.INVENTORY_GRPC_HOST || 'localhost:5002';
const PORT           = parseInt(process.env.PORT || '3000', 10);
const PROTO_DIR      = path.join(__dirname, 'proto');

const LOADER_OPTS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [PROTO_DIR],
};

// ---------------------------------------------------------------------------
// gRPC client factory
// ---------------------------------------------------------------------------
function loadClient(protoFile, packagePath, serviceName, host) {
  const pkgDef = protoLoader.loadSync(path.join(PROTO_DIR, protoFile), LOADER_OPTS);
  const pkg    = grpc.loadPackageDefinition(pkgDef);

  // traverse dot-separated path, e.g. "auction" → pkg.auction
  const ns = packagePath.split('.').reduce((o, k) => o && o[k], pkg);
  return new ns[serviceName](host, grpc.credentials.createInsecure());
}

const auctionClient   = loadClient('auction.proto',   'auction',   'AuctionService',   AUCTION_HOST);
const inventoryClient = loadClient('inventory.proto',  'inventory', 'InventoryService', INVENTORY_HOST);

// ---------------------------------------------------------------------------
// Helper: promisify a gRPC unary call
// ---------------------------------------------------------------------------
function call(client, method, request) {
  return new Promise((resolve, reject) => {
    client[method](request, (err, response) => {
      if (err) reject(err);
      else resolve(response);
    });
  });
}

// ---------------------------------------------------------------------------
// Helper: translate gRPC error to HTTP
// ---------------------------------------------------------------------------
function grpcErrToHttp(err, res) {
  const map = {
    2:  500, // UNKNOWN
    3:  400, // INVALID_ARGUMENT
    5:  404, // NOT_FOUND
    6:  409, // ALREADY_EXISTS
    7:  403, // PERMISSION_DENIED
    16: 401, // UNAUTHENTICATED
  };
  const status = map[err.code] || 500;
  res.status(status).json({ error: err.message || 'gRPC error', code: err.code, details: err.details });
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Auction Routes
// ---------------------------------------------------------------------------

// GET /api/auction/lots?page=0&pageSize=20&filters=...
app.get('/api/auction/lots', async (req, res) => {
  try {
    const page     = parseInt(req.query.page     || '0',  10);
    const pageSize = parseInt(req.query.pageSize || '20', 10);

    // Parse optional repeated filters: ?field=item_type&value=weapon
    const filters = [];
    if (req.query.field && req.query.value) {
      const fields = Array.isArray(req.query.field) ? req.query.field : [req.query.field];
      const values = Array.isArray(req.query.value) ? req.query.value : [req.query.value];
      fields.forEach((f, i) => filters.push({ lot_field: f, field_value: values[i] || '' }));
    }

    const result = await call(auctionClient, 'GetLots', {
      page:    { page_number: page, page_size: pageSize },
      filters: filters,
    });
    res.json(result);
  } catch (err) { grpcErrToHttp(err, res); }
});

// GET /api/auction/lots/owner/:ownerId
app.get('/api/auction/lots/owner/:ownerId', async (req, res) => {
  try {
    const result = await call(auctionClient, 'GetLotsByOwner', { owner_id: req.params.ownerId });
    res.json(result);
  } catch (err) { grpcErrToHttp(err, res); }
});

// GET /api/auction/lots/:lotId
app.get('/api/auction/lots/:lotId', async (req, res) => {
  try {
    const result = await call(auctionClient, 'GetLot', { lot_id: req.params.lotId });
    res.json(result);
  } catch (err) { grpcErrToHttp(err, res); }
});

// POST /api/auction/lots
// Body: { owner_id, item_id, buy_mode_enabled, bid_mode_enabled, start_price, buy_price, duration }
app.post('/api/auction/lots', async (req, res) => {
  try {
    const { owner_id, item_id, buy_mode_enabled, bid_mode_enabled, start_price, buy_price, duration } = req.body;
    const result = await call(auctionClient, 'CreateLot', {
      owner_id,
      item_id,
      buy_mode_enabled: !!buy_mode_enabled,
      bid_mode_enabled: !!bid_mode_enabled,
      start_price: parseInt(start_price, 10) || 0,
      buy_price:   parseInt(buy_price,   10) || 0,
      duration:    parseInt(duration,    10) || 3600,
    });
    res.json(result);
  } catch (err) { grpcErrToHttp(err, res); }
});

// POST /api/auction/lots/:lotId/bid
// Body: { bidder_id, bid_amount }
app.post('/api/auction/lots/:lotId/bid', async (req, res) => {
  try {
    const { bidder_id, bid_amount } = req.body;
    const result = await call(auctionClient, 'PlaceBid', {
      lot_id:     req.params.lotId,
      bidder_id,
      bid_amount: parseInt(bid_amount, 10) || 0,
    });
    res.json(result);
  } catch (err) { grpcErrToHttp(err, res); }
});

// POST /api/auction/lots/:lotId/buy
// Body: { buyer_id }
app.post('/api/auction/lots/:lotId/buy', async (req, res) => {
  try {
    const { buyer_id } = req.body;
    const result = await call(auctionClient, 'Buy', { lot_id: req.params.lotId, buyer_id });
    res.json(result);
  } catch (err) { grpcErrToHttp(err, res); }
});

// DELETE /api/auction/lots/:lotId?ownerId=XXX
app.delete('/api/auction/lots/:lotId', async (req, res) => {
  try {
    const owner_id = req.query.ownerId || req.body.owner_id || '';
    const result = await call(auctionClient, 'CancelLot', { lot_id: req.params.lotId, owner_id });
    res.json(result);
  } catch (err) { grpcErrToHttp(err, res); }
});

// ---------------------------------------------------------------------------
// Inventory Routes
// ---------------------------------------------------------------------------

// GET /api/inventory/:userId/items?page=0&pageSize=100
app.get('/api/inventory/:userId/items', async (req, res) => {
  try {
    const page     = parseInt(req.query.page     || '0',   10);
    const pageSize = parseInt(req.query.pageSize || '100', 10);

    const result = await call(inventoryClient, 'ListItems', {
      user_id: req.params.userId,
      page:    { page_number: page, page_size: pageSize },
      item_types: [],
    });
    res.json(result);
  } catch (err) { grpcErrToHttp(err, res); }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({
    status:        'ok',
    auction_host:  AUCTION_HOST,
    inventory_host: INVENTORY_HOST,
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`auction-web-ui running at http://localhost:${PORT}`);
  console.log(`  Auction gRPC   → ${AUCTION_HOST}`);
  console.log(`  Inventory gRPC → ${INVENTORY_HOST}`);
});
