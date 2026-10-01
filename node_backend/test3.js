const axios = require('axios');
require('dotenv').config({ path: '.env' });
const { lsqUrl } = require('./config/lsq');

async function test() {
  try {
    const lsqRes = await axios.get(lsqUrl('LeadManagement.svc/Leads.GetByPhoneNumber') + '&phone=9962665659');
    console.log(JSON.stringify(lsqRes.data, null, 2));
  } catch (err) {
    console.error(err.message);
  }
}
test();
