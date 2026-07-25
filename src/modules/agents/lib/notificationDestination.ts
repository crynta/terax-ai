export type NotificationDestination = {
  spaceLabel?: string;
  tabTitle?: string;
  hasDestination: boolean;
};

export function formatNotificationDestination({
  spaceName,
  tabTitle,
}: {
  spaceName?: string;
  tabTitle?: string;
}): NotificationDestination {
  const trimmedSpaceName = spaceName?.trim();
  const trimmedTabTitle = tabTitle?.trim();

  const destination: NotificationDestination = {
    hasDestination: Boolean(trimmedSpaceName || trimmedTabTitle),
  };

  if (trimmedSpaceName) {
    destination.spaceLabel = trimmedSpaceName.toLocaleUpperCase();
  }

  if (trimmedTabTitle) {
    destination.tabTitle = trimmedTabTitle;
  }

  return destination;
}
