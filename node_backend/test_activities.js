const axios = require('axios');
require('dotenv').config({ path: '.env' });
const { lsqUrl } = require('./config/lsq');

async function test() {
  try {
    const lsqRes = await axios.get(lsqUrl('ProspectActivity.svc/Retrieve') + '&leadId=5c4a14ea-cb26-4df0-b326-b0f571432e38');
    console.log(JSON.stringify(lsqRes.data.ProspectActivities.map(a => ({
      ActivityEvent: a.ActivityEvent,
      ActivityEventName: a.ActivityEventName,
      EventName: a.EventName,
      Data: a.Data
    })), null, 2));
  } catch (err) {
    console.error(err.message);
  }
}
test();
