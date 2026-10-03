import pathlib, sys, unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'deploy/vps'))
from route_port import replace_upstream
from enable_http2 import configure

CONFIG='''# Managed by Coin Desk: project-only route
server {
 listen 443 ssl;
 server_name coin-desk.62.171.141.206.sslip.io;
 location = /api/v1/quotes/stream {
  proxy_pass http://127.0.0.1:18420;
  proxy_buffering off; proxy_cache off; gzip off;
 }
 location / { proxy_pass http://127.0.0.1:18420; }
}
'''


class RouteSafety(unittest.TestCase):
    def test_rollback_changes_both_api_and_stream_together(self):
        new=replace_upstream(CONFIG,18421)
        self.assertEqual(new,CONFIG.replace(':18420;',':18421;'))
        self.assertEqual(replace_upstream(new,18420),CONFIG)

    def test_legacy_single_route(self):
        old=CONFIG[0:CONFIG.index(' location =')]+ ' location / { proxy_pass http://127.0.0.1:18420; }\n}\n'
        self.assertIn(':18421;',replace_upstream(old,18421))

    def test_mixed_or_unowned_upstreams_are_refused(self):
        for bad in [CONFIG.replace(':18420;',':18421;',1), CONFIG.replace('127.0.0.1','10.0.0.1'),CONFIG.replace('# Managed by Coin Desk: project-only route','unmanaged'),CONFIG.replace('location / {','location / { proxy_pass http://127.0.0.1:18420;')]:
            with self.assertRaises(ValueError): replace_upstream(bad,18422)

    def test_http2_keeps_sse_and_upstreams_and_is_idempotent(self):
        new=configure(CONFIG)
        self.assertEqual(new,CONFIG.replace('listen 443 ssl;','listen 443 ssl http2;'))
        self.assertEqual(configure(new),new)

    def test_http2_refuses_unowned_host(self):
        with self.assertRaises(ValueError): configure(CONFIG.replace('coin-desk.62.171.141.206.sslip.io','other.example.com'))
