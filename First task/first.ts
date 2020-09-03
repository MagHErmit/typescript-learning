/* eslint-disable guard-for-in */
/* eslint-disable require-jsdoc */
const axios = require('axios').default
async function main() {
  return await axios.get('https://pkgstore.datahub.io/core/country-list/data_json/data/8c458f2d15d9f2119654b29ede6e45b8/data_json.json').then(
      function(response) {
        const list: string[] = []
        for (const i in response.data) {
          list.push(response.data[i].Name)
        }
        return list
      }
  )
}
main().then((countries) => {
  console.log(countries)
}).catch((err) => {
  console.error(err)
})
