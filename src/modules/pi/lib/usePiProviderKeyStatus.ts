import { useEffect } from "react";
import { providerNeedsKey, providerSupportsKey } from "@/modules/ai/config";
import { getCustomEndpointKey, getKey } from "@/modules/ai/lib/keyring";
import { usePiControllerState } from "@/modules/pi/lib/PiControllerProvider";
import { resolvePiProviderConfig } from "@/modules/pi/lib/provider";
import { onKeysChanged } from "@/modules/settings/store";

type PiProviderResult = ReturnType<typeof resolvePiProviderConfig>;

export function usePiProviderKeyStatus(piProvider: PiProviderResult) {
  const [providerKeyStatus, setProviderKeyStatus] = usePiControllerState(
    "providerKeyStatus",
    undefined,
  );
  const [keyRefreshToken, setKeyRefreshToken] = usePiControllerState(
    "keyRefreshToken",
    0,
  );

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    onKeysChanged(() => setKeyRefreshToken((current) => current + 1))
      .then((nextUnlisten) => {
        if (alive) {
          unlisten = nextUnlisten;
        } else {
          nextUnlisten();
        }
      })
      .catch(() => {});

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function refreshProviderKeyStatus() {
      if (!piProvider.ok) {
        setProviderKeyStatus(undefined);
        return;
      }

      if (piProvider.config.authMode === "profile") {
        setProviderKeyStatus({
          configured: null,
          required: false,
          supported: false,
        });
        return;
      }

      const provider = piProvider.config.provider as Parameters<
        typeof providerSupportsKey
      >[0];
      const supported = providerSupportsKey(provider);
      const required = providerNeedsKey(provider);
      if (!supported) {
        setProviderKeyStatus({ configured: null, required, supported });
        return;
      }

      setProviderKeyStatus({ configured: null, required, supported });
      const key = piProvider.config.customEndpointId
        ? await getCustomEndpointKey(piProvider.config.customEndpointId)
        : await getKey(provider);
      if (alive) {
        setProviderKeyStatus({ configured: key !== null, required, supported });
      }
    }

    void refreshProviderKeyStatus();

    return () => {
      alive = false;
    };
  }, [keyRefreshToken, piProvider]);

  return providerKeyStatus;
}
