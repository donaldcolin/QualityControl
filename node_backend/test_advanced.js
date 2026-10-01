const axios = require('axios');
require('dotenv').config({ path: '.env' });
const { lsqUrl } = require('./config/lsq');

async function test() {
  try {
    const lsqRes = await axios.post(lsqUrl('LeadManagement.svc/Leads.GetBySearchParameters'), {
      AdvancedSearch: JSON.stringify({
        ConditionOperator: "Any",
        Conditions: [
          {
            LookupName: "Phone",
            ConditionOperator: "Contains",
            LookupValue: "9962665659"
          }
        ]
      }),
      Columns: { Include_CSV: "ProspectID,FirstName,LastName,Phone,Source,ProspectStage,OwnerId" },
      Paging: { PageIndex: 1, PageSize: 5 }
    });
    console.log(JSON.stringify(lsqRes.data, null, 2));
  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
  }
}
test();
