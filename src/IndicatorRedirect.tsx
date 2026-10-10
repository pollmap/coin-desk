import { Navigate, useLocation, useParams } from 'react-router-dom';
import { ASSETS } from '../shared/catalog';
import { resolveIndicator } from '../shared/indicator-catalog';

/** Load compatibility resolution only when an old indicator link is opened. */
export default function IndicatorRedirect() {
  const route = useParams(),
    location = useLocation(),
    p = new URLSearchParams(location.search);
  const asset = ASSETS.find((a) => a.id === (route.asset || p.get('asset')))?.id ?? 'BTC';
  p.set('asset', asset);
  p.set('metric', resolveIndicator(asset, location.pathname, p).id);
  return (
    <Navigate replace to={{ pathname: '/coins/' + asset, search: '?' + p, hash: location.hash }} />
  );
}
