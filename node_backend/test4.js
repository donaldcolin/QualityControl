const axios = require('axios');
require('dotenv').config({ path: '.env' });
const { lsqUrl } = require('./config/lsq');

async function test() {
  try {
    let lsqRes = await axios.post(lsqUrl('LeadManagement.svc/Leads.Get'), {
      Parameter: { LookupName: "Phone", LookupValue: "+91-9962665659", SqlType: "nvarchar" },
      Columns: { Include_CSV: "ProspectID,FirstName,LastName,Phone,Source,ProspectStage,OwnerId" },
      Paging: { PageIndex: 1, PageSize: 5 }
    });
    console.log("Exact match:", lsqRes.data.length);
    
    lsqRes = await axios.post(lsqUrl('LeadManagement.svc/Leads.Get'), {
      Parameter: { LookupName: "Phone", LookupValue: "9962665659", SqlType: "nvarchar" },
      Columns: { Include_CSV: "ProspectID,FirstName,LastName,Phone,Source,ProspectStage,OwnerId" },
      Paging: { PageIndex: 1, PageSize: 5 }
    });
    console.log("Without +91:", lsqRes.data.length);

  } catch (err) {
    console.error(err.message);
  }
}
test();
