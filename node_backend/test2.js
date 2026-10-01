const axios = require('axios');
require('dotenv').config({ path: '.env' });
const { lsqUrl } = require('./config/lsq');

async function test() {
  try {
    const lsqRes = await axios.post(lsqUrl('LeadManagement.svc/Leads.Get'), {
      Parameter: { LookupName: "Phone", LookupValue: "+91-9962665659", SqlType: "nvarchar" },
      Columns: { Include_CSV: "ProspectID,FirstName,LastName,Phone,Source,ProspectStage,OwnerId" },
      Paging: { PageIndex: 1, PageSize: 5 }
    });
    console.log(JSON.stringify(lsqRes.data, null, 2));
  } catch (err) {
    console.error(err.message);
  }
}
test();
