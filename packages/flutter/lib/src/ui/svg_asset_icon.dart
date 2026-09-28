library;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../app_assets.dart';

class SvgAssetIcon extends StatelessWidget {
  const SvgAssetIcon(this.asset, {super.key, this.size = 24});

  final String asset;
  final double size;

  @override
  Widget build(BuildContext context) {
    final IconThemeData iconTheme = IconTheme.of(context);
    final Color? color = iconTheme.color;

    return SvgPicture.asset(
      asset,
      package: AppAssets.packageName,
      width: iconTheme.size ?? size,
      height: iconTheme.size ?? size,
      colorFilter:
          color == null ? null : ColorFilter.mode(color, BlendMode.srcIn),
    );
  }
}
