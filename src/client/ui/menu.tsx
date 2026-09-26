import { Menu } from "@base-ui/react/menu";

export { Menu };

export function MenuItem(props: Menu.Item.Props) {
  return <Menu.Item render={<button type="button" />} nativeButton {...props} />;
}

export function MenuPopup({
  children,
  className,
  positioner,
  keepMounted,
  ...props
}: Omit<Menu.Popup.Props, "className"> & {
  className: string;
  positioner?: Menu.Positioner.Props;
  keepMounted?: boolean;
}) {
  return (
    <Menu.Portal keepMounted={keepMounted}>
      <Menu.Positioner
        className="overlay-positioner"
        sideOffset={6}
        align="end"
        collisionPadding={8}
        {...positioner}
      >
        <Menu.Popup className={`overlay-menu ${className}`} {...props}>
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}
