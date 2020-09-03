const axios = require('axios').default;

async function main() { 
    return await axios.get('https://pkgstore.datahub.io/core/country-list/data_json/data/8c458f2d15d9f2119654b29ede6e45b8/data_json.json').then(
            function (response) {
                let list: string[] = [];
                for (let i in response.data) {
                    list.push(response.data[i].Name);
                }
                return list;
            }
        );
    }
(async () => {
    try {
        let countries: string = await main();
        console.log(countries);
    } catch (err) {
        console.error(err);
    }
})();