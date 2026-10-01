const axios = require('axios');
require('dotenv').config({ path: 'node_backend/.env' });
const { lsqUrl } = require('./node_backend/config/lsq');

async function test() {
  try {
    const lsqRes = await axios.post(lsqUrl('LeadManagement.svc/Leads.Get'), {
      Parameter: { LookupName: "Phone", LookupValue: "9962665659", SqlType: "nvarchar" },
      Columns: { Include_CSV: "ProspectID,FirstName,LastName,Phone,Source,ProspectStage,OwnerId" },
      Paging: { PageIndex: 1, PageSize: 5 }
    });
    console.log(lsqRes.data.length, "leads found");
  } catch (err) {
    console.error(err.message);
  }
}
test();
