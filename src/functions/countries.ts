import axios from 'axios';

export async function main() {
  return axios.get('https://pkgstore.datahub.io/core/country-list/data_json/data/8c458f2d15d9f2119654b29ede6e45b8/data_json.json').then(
    response => {
      const list: string[] = [];
      response.data.forEach((n: { Name: string }) => {
        list.push(n.Name);
      });
      return list;
    }
  );
}
