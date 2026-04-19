import SwiftUI

/// Bottom sheet for switching the active account.
@MainActor
struct AccountSwitcherSheet: View {

    @Environment(\.themePalette) private var palette
    @EnvironmentObject private var appState: AppState

    var body: some View {
        BottomSheet(detents: [.medium, .large]) {
            VStack(spacing: Spacing.md) {
                Text("Accounts")
                    .font(Typography.title3)
                    .foregroundStyle(palette.textPrimary)
                ScrollView {
                    VStack(spacing: Spacing.xs) {
                        ForEach(Array(appState.accounts.enumerated()), id: \.element.id) { index, account in
                            accountRow(account: account, isSelected: appState.selectedAccountIndex == index, index: index)
                        }
                        addAccountButton
                    }
                    .padding(.horizontal, Spacing.md)
                }
            }
            .padding(.bottom, Spacing.md)
        }
    }

    private func accountRow(account: WalletAccount, isSelected: Bool, index: Int) -> some View {
        Button {
            appState.selectAccount(at: index)
            Haptics.selection()
        } label: {
            HStack {
                Image(systemName: Icons.person)
                    .foregroundStyle(isSelected ? palette.accent : palette.textSecondary)
                    .frame(width: 36, height: 36)
                    .background(palette.surfaceRaised, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(account.label)
                        .font(Typography.bodyCompact)
                        .foregroundStyle(palette.textPrimary)
                    Text(account.address)
                        .font(Typography.monoCaption)
                        .foregroundStyle(palette.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark")
                        .foregroundStyle(palette.success)
                }
            }
            .padding(.vertical, Spacing.xs)
            .padding(.horizontal, Spacing.sm)
            .background(palette.surfaceBase, in: RoundedRectangle(cornerRadius: Radii.md))
        }
        .buttonStyle(.plain)
    }

    private var addAccountButton: some View {
        Button {
            Haptics.selection()
        } label: {
            HStack {
                Image(systemName: Icons.personAdd)
                    .foregroundStyle(palette.accent)
                Text("Add account")
                    .font(Typography.label)
                    .foregroundStyle(palette.accent)
                Spacer()
            }
            .padding(Spacing.sm)
            .background(palette.accentSoft, in: RoundedRectangle(cornerRadius: Radii.md))
        }
    }
}
