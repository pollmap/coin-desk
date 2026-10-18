import {
  originalRainbowReferenceValid,
  originalRainbowVersionValid,
  type OriginalRainbowReference,
} from '../shared/btc-rainbow-original';
import { useData } from './hooks';

/** A saved version never silently becomes the newest model; price requests remain independent. */
export function useOriginalRainbowReference(enabled: boolean, version?: string) {
  const invalidVersion = !!version && !originalRainbowVersionValid(version);
  const response = useData<OriginalRainbowReference>(
    enabled && !invalidVersion
      ? '/api/v1/rainbow/original-reference' +
          (version ? '?model_version=' + encodeURIComponent(version) : '')
      : null,
    false,
    3600000,
  );
  const invalidData =
    !!response.data &&
    (!originalRainbowReferenceValid(response.data) ||
      (!!version && response.data.modelVersion !== version));
  const data = invalidData ? undefined : response.data;
  return {
    data,
    loading: enabled && !invalidVersion && response.loading,
    error: !enabled
      ? undefined
      : invalidVersion || invalidData
        ? '저장된 레인보우 모델을 확인할 수 없습니다.'
        : response.error
          ? '레인보우를 불러오지 못했습니다.'
          : undefined,
    reload: response.reload,
  };
}
