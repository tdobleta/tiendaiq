const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const routePrefix = '/prototipos/plantilla-01/';

http.createServer((request, response) => {
  const pathname = decodeURIComponent(request.url.split('?')[0]);
  const routedPath = pathname.startsWith(routePrefix)
    ? pathname.slice(routePrefix.length)
    : pathname;
  const relativePath = !routedPath || routedPath === '/' ? 'index.html' : routedPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, relativePath);

  if (!filePath.startsWith(root + path.sep)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.createReadStream(filePath)
    .on('error', () => {
      response.writeHead(404);
      response.end('Not found');
    })
    .pipe(response);
}).listen(4323, '127.0.0.1');
