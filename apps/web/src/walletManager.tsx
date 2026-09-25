import type { WalletId } from "@stacks-capital/wallets";
import { truncateAddress } from "@stacks-capital/ui";

const STACKS_WALLETS: Array<{ id: WalletId | null; label: string }> = [
  { id: "leather", label: "Leather" },
  { id: "xverse", label: "Xverse" },
  { id: null, label: "Asigna" },
  { id: null, label: "OKX" },
  { id: null, label: "Fordefi" },
];

const BITCOIN_WALLETS: Array<{ id: WalletId | null; label: string }> = [
  { id: "xverse", label: "Xverse Wallet" },
  { id: "leather", label: "Leather" },
];

export function WalletManager({
  open,
  network,
  installed,
  stacksAddress,
  stacksWalletId,
  bitcoinAddress,
  bitcoinWalletId,
  onClose,
  onConnectStacks,
  onConnectBitcoin,
  onDisconnectBitcoin,
}: {
  open: boolean;
  network: string;
  installed: readonly WalletId[];
  stacksAddress: string | null;
  stacksWalletId: WalletId | null;
  bitcoinAddress: string | null;
  bitcoinWalletId: WalletId | null;
  onClose: () => void;
  onConnectStacks: (id: WalletId) => void;
  onConnectBitcoin: (id: WalletId) => void;
  onDisconnectBitcoin: () => void;
}) {
  if (!open) return null;
  return (
    <div className="drawer-overlay">
      <button type="button" className="drawer-backdrop" aria-label="Close wallet manager" onClick={onClose} />
      <aside className="wallet-manager" role="dialog" aria-label="Wallet manager">
        <header className="wallet-manager-head">
          <h2>Wallet Manager</h2>
          <span className="wallet-manager-net">{network}</span>
          <button type="button" className="drawer-close-btn" aria-label="Close wallet manager" onClick={onClose}>
            ×
          </button>
        </header>

        <section className="wallet-manager-section">
          <h3>Stacks chain</h3>
          {stacksAddress !== null ? (
            <p className="wallet-manager-connected">
              Connected {stacksWalletId ?? "wallet"} · {truncateAddress(stacksAddress)}
            </p>
          ) : (
            <p className="wallet-manager-hint">Connect the Stacks wallet that holds sBTC and signs Stacks calls.</p>
          )}
          <ul>
            {STACKS_WALLETS.map((wallet) => {
              const id = wallet.id;
              return (
                <WalletRow
                  key={wallet.label}
                  label={wallet.label}
                  available={id !== null && installed.includes(id)}
                  connected={id !== null && id === stacksWalletId}
                  {...(id !== null && installed.includes(id) ? { onClick: () => onConnectStacks(id) } : {})}
                />
              );
            })}
          </ul>
        </section>

        <section className="wallet-manager-section">
          <h3>Bitcoin chain</h3>
          {bitcoinAddress !== null ? (
            <p className="wallet-manager-connected">
              Connected {bitcoinWalletId ?? "wallet"} · {truncateAddress(bitcoinAddress)}
              <button type="button" className="btn-secondary btn-sm" onClick={onDisconnectBitcoin}>
                Disconnect Bitcoin
              </button>
            </p>
          ) : (
            <p className="wallet-manager-hint">Connect the wallet where the BTC you want to bridge is stored.</p>
          )}
          <ul>
            {BITCOIN_WALLETS.map((wallet) => {
              const id = wallet.id;
              return (
                <WalletRow
                  key={wallet.label}
                  label={wallet.label}
                  available={id !== null && installed.includes(id)}
                  connected={id !== null && id === bitcoinWalletId && bitcoinAddress !== null}
                  {...(id !== null && installed.includes(id) ? { onClick: () => onConnectBitcoin(id) } : {})}
                />
              );
            })}
          </ul>
        </section>
      </aside>
    </div>
  );
}

function WalletRow({
  label,
  available,
  connected,
  onClick,
}: {
  label: string;
  available: boolean;
  connected: boolean;
  onClick?: () => void;
}) {
  const disabled = onClick === undefined;
  return (
    <li>
      <button
        type="button"
        className={`wallet-manager-row${connected ? " connected" : ""}`}
        disabled={disabled}
        onClick={onClick}
      >
        <span>{label}</span>
        <small>
          {connected ? "Connected" : available ? "Connect" : disabled && !available ? "Not installed" : "Unavailable"}
        </small>
      </button>
    </li>
  );
}
