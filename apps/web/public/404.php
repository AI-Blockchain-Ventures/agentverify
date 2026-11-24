<?php
// Unknown addresses under /agentverify/ are sent here by .htaccess: a real 404 status, then the "Page not found" page.
http_response_code(404);
header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__ . '/404.html');
