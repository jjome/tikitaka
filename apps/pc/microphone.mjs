const idKey = 'tikitaka_microphone', labelKey = 'tikitaka_microphone_label';
const cookieKey = 'tikitaka_microphone_choice';

export function rememberMicrophone(deviceId, label = '') {
  try {
    window.localStorage?.setItem(idKey, deviceId);
    window.localStorage?.setItem(labelKey, label);
  } catch {}
  // A device ID belongs to one origin. Share only the name across local ports,
  // then resolve that name to a fresh ID in the current origin.
  try {
    document.cookie = `${cookieKey}=${encodeURIComponent(JSON.stringify({ label: deviceId ? label : '' }))}; Path=/; Max-Age=7776000; SameSite=Lax`;
  } catch {}
}

async function preference() {
  let id = '', label = '';
  try {
    id = window.localStorage?.getItem(idKey) || '';
    label = window.localStorage?.getItem(labelKey) || '';
  } catch {}
  try {
    const value = document.cookie?.split('; ').find(item => item.startsWith(`${cookieKey}=`));
    if (value) {
      const shared = JSON.parse(decodeURIComponent(value.slice(cookieKey.length + 1)));
      if (typeof shared.label === 'string' && shared.label.length <= 160) {
        return { id: shared.label && shared.label === label ? id : '', label: shared.label };
      }
    }
  } catch {}
  // Optional, untracked PC configuration lets a known working microphone be
  // restored without changing product defaults or restarting the API server.
  if (['127.0.0.1', 'localhost', '[::1]'].includes(window.location?.hostname)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 750);
    try {
      const response = await fetch('/assets/microphone.local.json', { cache: 'no-store', signal: controller.signal });
      if (response.ok) {
        const setting = await response.json();
        if (typeof setting.label === 'string' && setting.label.trim() && setting.label.length <= 160) {
          return { id: '', label: setting.label };
        }
      }
    } catch {} finally { clearTimeout(timer); }
  }
  return { id, label };
}

function matchDevice(devices, label) {
  const matches = devices.filter(item => item.kind === 'audioinput' &&
    !['default', 'communications'].includes(item.deviceId) && item.label === label);
  return matches.length === 1 ? matches[0] : null;
}

export async function acquireMicrophone(audio, isCurrent = () => true, explicitId) {
  const media = navigator.mediaDevices;
  const choice = explicitId === undefined ? await preference() : { id: explicitId, label: '' };
  if (!isCurrent()) return null;
  const capture = async id => {
    const stream = await media.getUserMedia({ audio: { ...audio, ...(id ? { deviceId: { exact: id } } : {}) } });
    if (!isCurrent()) { stream.getTracks().forEach(track => track.stop()); return null; }
    return stream;
  };
  if (!choice.label) {
    const stream = await capture(choice.id);
    const label = stream?.getAudioTracks?.()[0]?.label;
    if (stream && choice.id && label) rememberMicrophone(choice.id, label);
    return stream;
  }
  let stream = null;
  try {
    let devices = await media.enumerateDevices();
    if (!isCurrent()) return null;
    let selected = matchDevice(devices, choice.label);
    if (!selected) {
      // Before permission, device labels may be hidden. Release the permission
      // stream before opening the preferred device; never keep both captures.
      stream = await capture('');
      if (!stream) return null;
      devices = await media.enumerateDevices();
      stream.getTracks().forEach(track => track.stop()); stream = null;
      if (!isCurrent()) return null;
      selected = matchDevice(devices, choice.label);
    }
    if (!selected) throw new Error('저장한 마이크를 찾을 수 없습니다. 마이크 점검 화면에서 입력 장치를 선택해주세요.');
    stream = await capture(selected.deviceId);
    if (stream) rememberMicrophone(selected.deviceId, selected.label);
    return stream;
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    throw error;
  }
}
