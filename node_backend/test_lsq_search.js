const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config({ path: 'node_backend/.env' });

const LSQ_HOST = process.env.LSQ_API_HOST || 'api-in21.leadsquared.com';
const LSQ_ACCESS_KEY = process.env.LSQ_ACCESS_KEY;
const LSQ_SECRET_KEY = process.env.LSQ_SECRET_KEY;

function lsqUrl(path) {
  return `https://${LSQ_HOST}/v2/${path}?accessKey=${LSQ_ACCESS_KEY}&secretKey=${LSQ_SECRET_KEY}`;
}

async function test() {
  try {
    const res = await axios.get(lsqUrl('LeadManagement.svc/Leads.GetByPhoneNumber') + '&phone=9962665659');
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
  }
}
test();
