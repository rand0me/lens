import { reaction } from "mobx";
import { BrowserWindow, shell } from "electron"
import windowStateKeeper from "electron-window-state"
import type { ClusterId } from "../common/cluster-store";
import { clusterStore } from "../common/cluster-store";
import logger from "./logger";

export class WindowManager {
  protected activeView: BrowserWindow;
  protected views = new Map<ClusterId, BrowserWindow>();
  protected disposers: CallableFunction[] = [];
  protected splashWindow: BrowserWindow;
  protected windowState: windowStateKeeper.State;

  constructor() {
    this.splashWindow = new BrowserWindow({
      width: 500,
      height: 300,
      backgroundColor: "#1e2124",
      center: true,
      frame: false,
      resizable: false,
      show: false,
    });

    // Manage main window size and position with state persistence
    this.windowState = windowStateKeeper({
      defaultHeight: 900,
      defaultWidth: 1440,
    });

    // init events and show active cluster view
    this.bindEvents();
  }

  protected bindEvents() {
    this.disposers.push(
      // auto-destroy views for removed clusters
      reaction(() => clusterStore.removedClusters.toJS(), removedClusters => {
        removedClusters.forEach(cluster => {
          this.destroyView(cluster.id);
        });
      }),
      // auto-show active cluster view
      reaction(() => clusterStore.activeClusterId, clusterId => this.activateView(clusterId), {
        fireImmediately: true,
      })
    )
  }

  async showSplash() {
    await this.splashWindow.loadURL("static://splash.html")
    this.splashWindow.show();
  }

  hideSplash() {
    this.splashWindow.hide();
  }

  getView(clusterId: ClusterId) {
    return this.views.get(clusterId);
  }

  async activateView(clusterId: ClusterId) {
    const cluster = clusterStore.getById(clusterId);
    if (!cluster) return;
    try {
      const activeView = this.activeView;
      const isLoadedBefore = !!this.getView(clusterId);
      const view = this.initView(clusterId);
      logger.info(`[WINDOW-MANAGER]: activating cluster view`, {
        id: view.id,
        clusterId: cluster.id,
        contextName: cluster.contextName,
        isLoadedBefore: isLoadedBefore,
      });
      if (activeView !== view) {
        this.activeView = view;
        if (!isLoadedBefore) {
          await cluster.whenReady;
          await view.loadURL(cluster.webContentUrl);
          this.hideSplash();
        }
        // refresh position and hide previous active window
        if (activeView) {
          view.setBounds(activeView.getBounds());
          activeView.hide();
        }
        view.show();
      }
    } catch (err) {
      logger.error(`[WINDOW-MANAGER]: can't activate cluster view`, {
        clusterId: cluster.id,
        err: String(err),
      });
    }
  }

  protected initView(clusterId: ClusterId) {
    let view = this.getView(clusterId);
    if (!view) {
      const { width, height, x, y } = this.windowState;
      view = new BrowserWindow({
        show: false,
        x: x, y: y,
        width: width,
        height: height,
        titleBarStyle: "hidden",
        backgroundColor: "#1e2124",
        webPreferences: {
          nodeIntegration: true,
          enableRemoteModule: true,
        },
      });
      // open external links in default browser (target=_blank, window.open)
      view.webContents.on("new-window", (event, url) => {
        event.preventDefault();
        shell.openExternal(url);
      });
      this.views.set(clusterId, view);
      this.windowState.manage(view);
    }
    return view;
  }

  protected destroyView(clusterId: ClusterId) {
    const view = this.views.get(clusterId);
    if (view) {
      view.destroy();
      this.views.delete(clusterId);
    }
  }

  destroy() {
    this.windowState.unmanage();
    this.disposers.forEach(dispose => dispose());
    this.disposers.length = 0;
    this.views.forEach(view => view.destroy());
    this.views.clear();
    this.splashWindow.destroy();
    this.splashWindow = null;
    this.activeView = null;
  }
}
