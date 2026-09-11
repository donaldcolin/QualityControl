require('dotenv').config();

function lsqParams() {
  const host = process.env.LSQ_API_HOST || 'https://api-in21.leadsquared.com/v2';
  const accessKey = process.env.LSQ_ACCESS_KEY;
  const secretKey = process.env.LSQ_SECRET_KEY;
  return { host, accessKey, secretKey };
}

function lsqUrl(path) {
  const { host, accessKey, secretKey } = lsqParams();
  return `${host}/${path}?accessKey=${accessKey}&secretKey=${secretKey}`;
}

module.exports = {
  lsqParams,
  lsqUrl
};
