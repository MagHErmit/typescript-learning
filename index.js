const axios = require('axios');

async function main() {
  return axios.get('https://pkgstore.datahub.io/core/country-list/data_json/data/8c458f2d15d9f2119654b29ede6e45b8/data_json.json').then(
    response => {
      let list = '';
      response.data.forEach(n => {
        list += n.Name;
        list += '\n';
      });
      return list;
    }
  );
}

exports.webContries = (req, res) => {
  main().then(str => res.send(str));
};
