const elastic = require('../utils/elasticClient');
const dynamo = require('../utils/dynamoClient');


// Fuzzy search maps by key name.
async function fuzzySearch(query) {
  // If the query is specified search for that, otherwise return a
  // random document.
  const response = await elastic.client.search({
    index: 'maps',
    body: query ? elastic.fuzzy('key', query) : elastic.random(),
  });

  // Format results nicely before returning them.
  return response.hits.hits.map(hit => ({
    key: hit._source.key,
    id: hit._id,
    // TODO - consider adding number of resources here.
  }));
}


// Get a specific map by ID.
// TODO - [priority somewhat high, this is making retrieving maps very slow]
// change the logic inside this function, we can most likely execute all
// requests at once. They don't depend on each other so there's no need for
// waiting between each request.
async function byID(mapID) {
  // Get Map metadata from DynamoDB.
  const { Item } = await dynamo('get', {
    TableName: 'Maps',
    Key: { mapID: Number(mapID) },
  });

  const map = {
      ...Item,
      nodes: {},
      resources: {},
  };

  // Query DynamoDB to get the nodes for the current map.
  const nodes = (await dynamo('query', {
    TableName: 'Nodes',
    IndexName: 'MapIndex',
    Select: 'ALL_ATTRIBUTES',
    KeyConditionExpression: 'mapID = :value',
    ExpressionAttributeValues: {
      ':value': Number(mapID),
    },
  })).Items;

  // Query DynamoDB to get the resources for the current map.
  const resources = (await dynamo('query', {
    TableName: 'Resources',
    IndexName: 'MapIndex',
    Select: 'ALL_ATTRIBUTES',
    KeyConditionExpression: 'mapID = :value',
    ExpressionAttributeValues: {
      ':value': Number(mapID),
    },
  })).Items;

  // Convert the list to a dictionary having parent nodes as keys, and lists
  // of nodes as values. This is used by the render component.
  nodes.forEach((node) => {
    if (map.nodes[node.parentID]) {
      // If there's already some nodes with the same parent, append this node
      // to the list.

      map.nodes[node.parentID].push(node);
    } else if (node.parentID === null) {
      // If the parentID is null, it means that this is the root node, and
      // there can be only one root node, so no point in having an array here.

      map.nodes[node.parentID] = node;
    } else {
      // If none of the above cases apply, we create a list and add this node
      // to it.

      map.nodes[node.parentID] = [node];
    }
  });

  // Convert the list to a dictionary having parent nodes as keys, and lists
  // of resources as values. This is used by the render component.
  resources.forEach((resource) => {
    // Same logic as above apply, only that we don't have a "root resource".
    // All resources must have a parent node, and no resource has a child.
    if (map.resources[resource.parentID]) {
      map.resources[resource.parentID].push(resource);
    } else {
      map.resources[resource.parentID] = [resource];
    }
  });

  return map;
}


// Get a specific map by title.
async function byTitle(title) {
  // Search for map by title, with elasticsearch.
  const response = await elastic.client.search({
    index: 'maps',
    body: elastic.get({ title }),
  });

  const hits = response.hits.hits;

  // There can't be more than one result, as the limit for this ES query is 1,
  // and in any case, map titles should be unique.
  if (hits.length !== 1) {
    throw Error('map not found');
  }

  // Now that we have the ID, let's retrieve the whole map.
  return byID(hits[0]._id);
}


module.exports = {
  fuzzySearch,
  byID,
  byTitle,
};