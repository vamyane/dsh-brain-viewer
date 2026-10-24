/**
 * dsh-brain 浏览器半边（模板）。
 * build.mjs 会把 gzip+base64 的 app/viewer.html 塞进 APP_GZIP_B64，打开面板时才解压成 Blob。
 * 图谱数据不在 HTML 里：iframe 启动时去 fetch 宿主路由 /api/dsh-brain/graph，
 * 所以写完记忆重开面板就是最新，不需要重新打包、也不需要刷新页面。
 *
 * 两个槽位：
 *  - sidebar.footer.action：左侧栏底部的「🧠 AI 大脑」按钮
 *  - shell.overlay：点开后盖在整页上的全屏面板，里面用 iframe(Blob URL) 载入图谱
 */
window.__ModuleLoader__.load({
  id: "dsh-brain-viewer",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");

    var APP_GZIP_B64 = "H4sIAAAAAAACCsV9a3Mbx7Hod/2KMVQxsORigQXAF0BQl3pZutGrJCW2Lg+LtcAOgBUXu6vdBQmI4i1ZtmzJliMlR37Jj9g5fp8T2U5iW5Zoqyr3nzgESH3S/Qm3emZ2d/YBkLKTc+OKiJ3p6Znp6enp6e6ZmX1KNetuz8Ko5bb1uT2z8AfpitGspi62sgdOpCANK+rcntk2dhVUbym2g91qquM2stMpL9lQ2riaWtHwqmXabgrVTcPFhltNrWqq26qqeEWr4yz5EDVDczVFzzp1RcdVGXC4mqvjufmjqP/Rp9sv/h79/TvUv/rXrb8+6L/z4/ZXX8/mKMCeWcftwV+EyrZpumt7EEIom601y3sxbsiNyYqfUijvxUU80yh6SY1meW++IU8VFC+l3XGxWt47WZoqTdd8MEUz3PLemZJSrE17ibpm4LLdrCkZeUIsFMVSQZTkvOBlW4qBdZpfmJgQvf9L09M+SM20VWyPwFFvaVYCiqmCD+G0FNVcLeeRXLC6qJS3uiiKjgKv70GoZqo9SVXsZZ5GeUXOy2qIRrIsK4U6TyNcwNONfIRGYXIwGoUJx9GoNC3Kk0VRni6JklxKIlPQ5unJZBqFcEwnkKmYF0uyODEjSlM7kigvwn9SacKnz9hazexmHe2iZjTLtOJszexCFkwBEei31lbspmaU85UW1pottyzn87+qmCvYbujmarmlqSo2KjWlvty0zY6hllcUOwN0FSp1Uzdt9t1osvY1TMPNNpS2pvfKWcWydJx1eo6L2+J+XTOWjyv1M+TzsGm4YuoMbpoY/eZoSkyd0ozmYcVoojMHUmLquFa3TcdsuOiccgRrKdFRDCfrYFtrMDqs4tqy5mZJfU7bNN0W9FIxYNppioNVj0PWuMbbigqzsgl/seFm5EIe6DdN/lVcNJH/FSpO/0pEXi8LQvBbQFP5XwmANjeGNu9d7399Zev2g/69Fx5v3Nl+4cbg7S+3f7jbf/DvmcJBAeXQ9itXtq58P7798P2t+w8zz+LaM8cgefDBy1t//nH80X++tXn/LgEdy+1BaG+tKe5t6uLe+pplOpqrmUa5oXWxWtEMB7vlfEXVHEtXeuWabtaX12mRtYtZzVBxt5yvWKZmuNjO4hVsuE7ZMA1MgJq6DyQPBar7MIVKvWM7pl1u2kqN5kmqrTSbmtFc47JqmtFc37MHIampK46zFuMQMhGECuN32eoix9Q11aMmSRYIY6m2aWUbmu5iu1zTO3ZGLlldITzMI+AIj9M5QXHTD4G0DsQ6tqMk1XHDLRcKVrfimlZZnra6Fa//E0k0qnQcbGcdrOO66xONokZSzVYMdc0bnYaOuxVF15pGVnNx2ynXMWCrNBWrLOetLl9SN5vmGlkvynLR6vozEH6z6QqM2nHKE/lf8XNwb2FisoiZVOL6n0fwX8mTCMUpcWZGLBQniIQSIQ/6GsucmBC4ZrXkQCbQ2aVdxGV5xurSz1XaysmJfEXHLlDKsZQ6TD6pGO6f06l5qCasLmlboeihoVhhDHg5QkSxEENciCB2FdfDPDMEsyxNRHATiS5QmBXF1hTDzRqdNra1etlVah1dseHboWztmpYNHY3yjk3HaNpjnkmOeSYrITaAMQe4ODtAZyQHK3a9FeC3sa642grmMpFmWB2X8UghPx0wSbEUYxJgr53mG+WYIXM1KtAtRVWB/HlUzBMqk+HiR4/Q2Oy4ZF0kM8WvYMhs/UUTOkKXctnSlTpumTrM8fhQxws0zHrHWWNkowVikyFUTFquqcEIKTXH1DsuZkwww3hgJkyVfDLfsck6WhyGZ73V9ccASkzQWSDVXGONZ4NgnGT5X8sVbHrGWIAtDEx0/iuZgOLejbSFienaisHGTpKnHY965RYoOGtRfh/JF8VpwSsumQYru7fRaCQJ5hAmlkjEyl4bOx3ddYbyVJ5wFGh1FTbrJxNmOszDqI42chB35Lsh1PYI7WsKrP2S0zJX1+IqCctGqray5rElLDnJkiPCNk8gPPmK6GiKfJLkYD2k90WXw4IQwiKppidlpwIZO5W4DkPrYvRAUt3wlqQsUS+UjmsOXX7YEgXzGXhKx01sqMO1lJrpuma7XMiHFJUQueCf7KqtWGX4h1APmk+Yoq106ba03NaMzMRk3uqKU/kVJlFht7G22wnFKFOYDoudfIxSM17lOy/2ES6I6lo/T3hBr4apl/mdZRABCUmPScenVrL48LN5buJW7OlEbhpWB5KMtdHckydTaBfaDMMomY3GmgkaldsrS8XpUAZtMycGKOWjVKWteEprgwVEMVzKvi3NcBOZl6itjHcLnjhumHa7TH7pioufy2Qn8r8SfLYuxXU4MsAJtEjQPuPMk7jj2YOQ4mgq3kuk4w4aHpO/pBckkY5sscBrflP88u6L6UlulsDkReQfkuxLbyIn/iWye8QqPL3zDJj292CJo1ZX9HoGbAVoHAElhNB08YsgqVhwUL1T0+rZGr6oYTsjFcAiIkqFSVEmk4YbCrqsJFaYj8KWy14HnLpt6npNsdmky9N9q246+FR4gCOLrexvAQO9qZzn2Z40wFJsbLhDdbrIJikizkA1zno7O58bSlSV4xo5Qqgsa/VlbK+FV44o+8tSKVnvdHHXzQYk7VgWtuuKgytstWKsPc1aRGh7FkyR/jYQMQnPNWA6aTfI91QqTnidzTJiTzL11VWaztpOixfMkXAD5QJXHjmWYkQpkrC2PJG+HZquVhdN8SQ51OWrA1kT7u9UIal+noQlT5b5Or3saUZJKvtw7SU/SfkCrNLP2FpgfGjamlqBf7Iublswb0AF7bQNpyw3bCQ3bF+titDWGxsPJaqFlbv4wjNscWIMMZHPR+ooRKvQGEHB3F02TLut6AkqYkRHXzVtNVuzsbJcJv9mFV0PBumU4rZGcQVraBKSyHBOhgQ6kRFWF6mK08JRJvLY3BckybSlLTxpa81/agsZh2Wn6Q4deDiqtEtGzaYzegcRktwWjoeZkACExzTHTZjFqmbjOpG1lPMIwxXCxVCt47qmsaboerkD1s3KbtRPXuWcpLMzMm+mknTOGBcla51R4ZXQXiahR20r8jEjSgjPz95mcBjim4xdTE2693Q1K6rrePrLdKLZkyd3go4/7dE7ridG3APgLojpdZ4umuc1B5aIJLngUOSrLc3FhEdBSpAFIkFBIGqkmJUnmYkeOku1CV/lnSl5GchpK7oe5ExOVHiqTkbsOdIE26j9jzZWNSUT7KemQKETqPuJs3qKIUNldDomW/fkErMOUxsDXeDiRXm9lRYMNLEsKoImtk7cP7M55keczTHfJjhD5vbM1hVjRXGQplZTtWZqbjZHE8I5TX1YTp3PoH5TbIO3clbVVlAdnAHVFLGJp+b4JDB2Q1FVW5mbbcmBI3Q215JZegSL06ml5ngfKfhMB1/e3Lz3xdaV7wdvfbl57/LWly+jtoq2737Vf/hSMhZXcVOk6eSXVxUlCzR9Dw/tmX1TMTRkyEgyQrNk5AjSCykEvuVqCvSsFOIsktXU4Na7W3/7E20byqGtj9/fenCzf/WFny5/kkIwd+tm29Kxi6sps9FIIcfCul5v4fpyNdVQdAd71QEzeA1ZrqmpudxsDtJYNjQT2sKMESmOnP4PKsP8AXINSpOaaxzW3BQizudq6tHLr239cHf705e2P/1Dau6nj/40m6MFk3EgM0BzpqVY2EdEx5Y6xFJz//ePn34wGpOP5rgJcsDH49NssHFl69MHjzeuPXrw1vbdj/pX//p440b/5if9P7/Vf+WP25fffLxxPTX3j8tf7bKeUx2gb7iawe0ft25/03/ls63bD1JzP935cPe9P6bUsO6jG7z149ZH9/u3Xtv69KvU3LyyyzadbeE2R8JrLw9e+9Pgrd8N7ryZmvvpzVsBFjasIc6lRiSKi/32eZ0Dg816am7w4M72D3e3Nj4f3P6RzKpX3xi8+kP/+79uffqAfF/5r/7z71In5dYXz29/+gmD2rry/ebGnf477/c3vichDDdv9F9+sP38na0XP4HBee/twZ//NHjz2817rwEvPXjr8cZ1v7VEeJEGEgGW4slBZIu/GwqIcPWvj978c2ru/7wZoiHXIbo7SgVof61B148fOn7y9LmA/1uFAIIoQ0CdViGKDTYXHK6z8MlNJyvIOtSFDCuKwFNvU8HcnJutgRjbfv429QnP5mpzs1qA6SBupubyszktqCgoOHjz20dv/i1WRHFxau6ny7dDpcLyzwcGrTg1NyQTFNJUsvz11MYUa/3WnRdHyFmmonDEO1GzOXFLBt/jWYBxNcvP3jPr1G3NoiK1ZiuakVUVV/FkKwQSaHUFJEPuvGMaUI4WmPNKzuXGlpb2n54/emJp/tTRpf0nT549c/b0/KmlpbFcHHhPbmwPGkMQzINttFJ4vHGtkC9MZuV8tjDxeOP6T5dv/3T5Nhrc+8vgj/8+eP/bwfsvbl39FJ2sOZqqKUYocufRlf/of/zm4PJ72999+ejl1/rP33m8cQewIyQLLAwgR8MActsvXu+/9Jf+1c8evfDZ1u3PEAkLQJv3Lg/+68PB5U8H179/9PLNrdsg5zTDcRWjjlV0oaOoDhpHx46eOHTm8cb1xxs3KHqEEJ3COTpz+ze/GNz+HnUMjdhetv74+aO3vnm8cYNOxv6D+5sPHmz+8Hr/5Q82f3j98cY7FEtBQIMb1x+9e5n29vHGncFfPhy8e53KwX9cfp5+bt7/aPP+HwZvftu/e6N/9bPNe69tf/d7ZOMLHey484bWJsNz2Fba2BcEqIryqH/vU9JoVl1RQMdOHoRaSCRE/+YX/Xc/e/Tu5e1Pnt+68yLtz+a9V/sv39/63Vek8bcH714fvP7Vo5dvbt575dHbt3xUJQHRjucYGajYyj26fH3z3p8fvfBD/+YX259+0r/5e0phTyIBQfovvQZ9vHfv0ecP0GS+YTkIhuXlmxToH5evQB39ey/0v77cf+/W4IOXNx+8tnX7a1TraLq61LQVqyVZPbT1yYOt+w+37r7Z//iHxxvXth/e2v7wBhOAtFPXP9+69dLjjRvbD98GheXK94MvbwecNHjnb1vvPv944zqrcfvVjwff3Nz+9Fr/7c8o4SmTPN648ejy5f4776PCQcT45MFb/WvfPt64NrhxfevrB/33X+3futb//ltkKW7Lx0j4vBhlcKD/618NXru7ee+jrU9fG7z38eD+Lcr1lLZ//w5tvfpfW//56uD6v/c3Lj/euBbt+O0/Dq7d2rrzIiLzVYKQIh5x/6Wr/W9uPN64QSnUv/nl1u3P/KH7+3fo4Jkj6NF7fxq89xC6cPMPmw++pWWQYlk5OjVjWDfv3d/6/D766aU/INqwwZvfogZ26y3Uv/tw896D7e++3Lr9tTc/coql5VSnlSVtzJHGw1B8+WDrzouDt76k1SIuVwL5Ag269sajq6AMPXr5BnSSZJ6ihOXphFD/pbf7d29QyQjTbOMy7VX/q6+hhncvD96gfPza1u3P6Dz8x+Xn6Wf/2neDN7569OE3j977Ex2u3J5GxyA7aFQzTTdzcP7sPNlhpDoORo5ra3U3BTsjrYEyT0EuunQJkR+SYarYiXxKOjaabktAdJcCW6L9pukesm3TzqSpBBu89eXW5/e37rz4eONaHm3e+4IKLcpC/avXtr9jE2jr7odb9x8+3rgzWzdVPAcVINc0dSdnY8IeUvu8g7JZFbfN2RyBQYNrbyAKns2umvYy2cmhzR8+gNn+zt3+D68zyH9cvpJmJlUbux3boHFsexDYW9CJkwcPnUFVFPRMRIcOPhOkYbWJyZYRoM8cmT91yMtxQDMFshgdXfcgSOIxUPVRlWSINOmgYi9zKeYq0WtRFbl2B3t0J+gDkvKY8Co62laaOCNUuBzJNHRTUVEVeaObEdaQZqwouqbC9lWooPVQAceuoyrth6RDSiWozGtjrC7IeJKqCDxfE0RTeuGDQKWz504RCtOeWrZ5Hjwr8HtNB423nH704fdb79xNiwiRVpbTe2W1hNXptIgAWTm9dzKvTDSU9LrIHDlGHVthHINPrvQffsPjyDemJidxgKOgqqVaw8MBLFem65+Po//dx/2r3/E4JtXCtDoT4FCmpmtBOyxsO6ZRDuHYvH8fEAQoaqWJYp5D0ajVGoWSh0LFdc3RKBK/GS/9devPb/DNqM3IdbnO4Ziekqdkvxk2bmAbG3VcDnA8f7P/8Q8hHFienlA5HKWpQm3Sw+Esa7pHD5+kr1zefiGEo14oyXm+HbWZQrHu4zA7NrSBx7H9zYuDN97mcZSmJiYmOXrQkFkPB7Y0x1RxaGipWORxFIsleWIijgO4zpucJ08fPHQaVdFCmrFcWkwzxkmLaRj+tJgm3U6LaTqSaTHtjQek+WQFQNK3tJhmDUwvQj2+mG3hbsFu1jItZsihwgctWBAFftRwMy3J0bU6zshiURDlSSEHUcsoll0UJ0ZlT4hTfvYiP8cOnDwGM4x0nnRcapj2IaXeyvgTeFlYA7CF5UWApJT0mk2m6MLyIpUSAqNrLBdShfUKWhcqnkitNQ+gKlLNeqeNDVdqYveQjuHn/t5RNZOuNdOCiGrNLqoCKOQfgJD3rptJF1QqqgFNUx+JpqkHoObKSNA6VGiuQIXmyvAKwYI3AourWQEsM4kc0keVYEBBqQuj4S+kAyI+CzquiI7AH6+4atmoio4rbkuCiItVzVDNVYkeEDildbF+GnRlWJFkERX8WvcffWbpmdPzpwAXWe7Y2o3mUAH8KV6VdaUNbNAt50XUg38ulmV/6jQ093+hKiCuK21Qy9li5uUTIzaqoqwsIuooxyr59ABWNEer6Xg3LMlAKVuS9ZGwl7fAmqvEKuKwTBFZYHNxThqwNoF5S0RtYu3hU1S6tpEv0uNcDmUj/0OP/vRi/6MXt269tAcxSsXaZ4iasIYMSUNVpFWQIam4CaSQVKB7nm+pop73Kd5WrAy/bnrCYNErQHSOeHVYWAM8C3ghv7goWR2nlcEL8qJQYalykJqHVDYNkzq3+QOonVuvfDu4/DwoosTwBZHjxEYDuWAHu+7pRRFm8TtlaO3nmJJwWDcVt1iYt22llzkhiCTzXHKmz8OaYw0tD5k7lLdaioOHgzRMG2UAbkmr5itoSZs9Af+OjzMhTJq/sKQtet2D31K3Qpsey+gxzypUyjIzSxoaQ7I0KU/ni8UZAf0KTUqF6WKBl70Q2n4CtFg6IaBfBzXb7YU4kMw508aHQMOEVWlRRDpWGsH3aMYgTSNj4reZsImIalyCvLhIOwEKpiIto6eqVeQvWejpp1EtmigEzWLMxfRnrDs4aCKfF/Dd9o/fb71+wxM9MN3bmtEty3hGbGtGj/5Qut1ylv3qkV9EJgybc6yvWiNjSN3Z/SD9ugL9UzVg9GjO3H4JMAv0D8kJyvVouR4t16saUo+V69FyPVqO5rAucWo5UIoqs+CJ9JR02ghfz4Wshfxihab3wukyGwjavGgZNM5/FygOpRvDEYYrhpf8Z/31QelmaD1Z2kQRyXlBRAeOxCB6FKJHILxpduAATNIMLTvO6JoriOjAgXN+Rm+cES5XGCp1tn+82n/lc14vIg68zLJmqBwLwx6H6RSaoS6CLCWfEuNJfv9GZfk+5BLlA5WRG+xk1vmaNOcYVhpgtyXLCiu9jKqhGXDpkpfEFLpKGAv1SvpMSFZ/EP4BckNaFtA+VJDkCTSO8lJpYoyQWDebspUhS4SAyqgoTZPsqUI8O9Q/f3xkaUYM1ntbRHJBEGLddLqZbtC9Z3MFNA6LtNRF46g7Br8uRrrk9DK9oMQRv0QPjaNeUCJEBQxeywwjAvAZUz80w8D2s+AyrBBthU8+goMd5kKteUAEpQ5UsQOL8VleZ7gRqkvEBelxakM3TTvz7Jhq2UIF1SXq3w7nHqG5PgLipPTRPDuetrrpip/uYzhCM0ixdS+0rdmVHOye9ZzBGdWyyRk49peBmSu7AgP50dQF1NQl74gnOVLX1A/Q5pFftEFe4BdVtfxxf3YsL81M5A48K6Ij8DOfO3BE8I0YSZOOWPZ8Ndo3O4Dp1/9o6id/HSxHTD/tKOr+TsOHAXsI/91SdJP/hqWA/4Zlg/8milmQ4FUDaE/ZZlNEYFyhvwgo/OSB5l2iLlI4/4OAsi8e+qDiKomawdiUL9egB8PgAukH/RoGFSx/VDEaK/nFoPvDigUraqwY6c+wclN5DhJ6ecDsGC7dHEBnuE9oGfcJNXKfpBb/m9PKj6pdpnysUJkWfB0wbewrIh75PHhfh/ntmaUDJ48fPwkq4wLh4LTiurZW67gYreB6ASlLwFmVNN3Ppz1HAsnrLNnYGZZlKUYsqwHkQZ2li6bZ9jNXFLunGU1abmVJDzIgwTUP6JqVIb+duo2xIax5AL7UhdwMzZW6OdIsqTtWkPJZWcqLSJbyWZbbY7k9yBX8qtbTexBalM6bmpFJ/5vBbeZAr1n6LRi8AlqNI4BB40NJZpkBWYJM2ntlyU7IW8H1IlKW6qY+oqCiWy1lKFEtc/ViElFLaCWEd8XUVNRWNNjMBJSkWJyLqAotRGNRhIj2DeyChNoekfMSLJxkuKWuiDzq8sk9IYqFDgaqojoap+Qao0xBPoHhxhy+6qa+dIpFKdH6SxnGF4wlRJRnAx2qC/rtFSDEFT0qhsF00usQo+/AEYfPBDPGspmVCUEwUKdtUWLuaiyG8v6IQYLNOZVEmZUlne8JYxRURfT8s+NiK0OmQF6amBaRygOTTQWarQLp8iUBdjp1xVbDZD9sK80DoPV5ZCTtl+xmTaRdkRQ0hpTdzCTYDdGZtJtp868QNP+d8mTkOP53TKVfOn12GMgnmQDcgJVQZ4nsIhI5PcpxHiwa3phTvzl25p8toEFd3rUY9qYwzV1ZUir//8c+EKORzvwCUaoQGRnu+xPLTjpaP0d4JpD3XyU7cdfKZNUxdawoFQRwlS8pv1hs5qXJSaDs9CQhrbizyAx2fC0ISsxA2IuIHLvObWbB1NTUpbqNFRefCeDYbqQJp2cg8QzZHWccWt7PhFhDTfcKOty256mmDiZumnNKgQgOF0Bg7yEdOHn81NFjh5bOnJ0/+5szgmdPQcht2eYq0YOZL5nWXkYwFXmMR42GecxsZhyB1bnO76Gd2DbZss2mrbQzK46IGg5HAIsnwCkGFXRQcV2l3mL9s0SPlE1d+u2h02cPPbd05sj8wUOnRbTit2RkqcOn5585fujEWb9cgy8Ht5l4bbDixGRZATUtQs1jR0/8ehekBOQ8IRk2j5JWIiUtf6sZGFYMzX3mmGcMcO2eXyXZbcKOlneyrOJaU0+LaI1M/DI12vtXqrBvy8btju5qlq5hdZ4AMtO9Za5i+1Tg0Ey3tGYra2Eb1gMIZUqvC6x6BNacaPW4a2FbAzeLomdpW3xLASOt4HXW3w6TTLpfprQ61HWxATImk54/8cyxQ0t+INWSAjs1J4IUspPRNnVJ1RylpmNgh4OHTp09snT20JmzAgeADS9//7FDJw7yWTUdG+rhjlE/gy3FBs97U5fOnD6wNH/s1JF5wg4nTxxaOn70xG/OLMXSh+VTeQH/83bnqOpPGbZ/ET211W+Ot3/nYJmGJnorvA/r7/A5YG/hFX2hHrTD5zbFBS6Ha7Ic30REZ27btwGwpgNMov0YtReMRX8s58lyfMykoX8Eu1DxDUDk+ItEVk+/xG+o9sEXSROIdKQQRFSPLmQpRrQQWW5HlwIQvhhjrLaXss6NHrGNKG4msLMspOnqmhbTZIknf23yb504vdminF70q6CIJLqDG9q4oIo0hUyHeMNrSWDnibVkMVJAYvra0CoDXGkGmg7zmFepz3BD+g9KTaTrDE1gB/PXhf2dRgPbmdBE1AyVJTd1af706flzS/t/c/gwyHSGIQROQMHOEwePmX0W/IHOyiK4kBD7k5VFWeQzIdHLRLIos7xFgcx0WBOOHlg6eHr+2fAM36F7gaVvKEhg/BsKEtgDh4JwJsKhMIzXvUgphNZRXYHQvAwOFru6aTgm2HwV28ikF0jo3aIfCPuaFyc4NNrxDiyLWGpjx1GaOFo3J8DXR1leaQzs4P0X+w/uh83nJI7tKJyK8tZNzvZWCVvWQpa4SswSx7k5wcsJPs7Aw0mXH8+FTr2A2qK0vBiQyquaOvA0TqrQlSvwbATFBfB/+Z/g9J5DhbzgtTuKap3TI/zGKtV8RZmNGlArCtd2AMNEvWZAC8piZWi/qFd8eRHaFs2RF2mnGSnDjsxIw2rVfKU2GzXRVmqRhsF4+EALtRENawxtWINvGIwqbVgj1DBA6NmgvWCNWb8nvgF5pJ06Bh3okp6dOoSatCVAPcqWHYMOUHv29QC1xyAMeEoYaYOPQceVTzKRwLnuZHy/MFHiTv5a4CI82ZDBzUxgyvJCUuYgdHxf8F2mkStcCQe7nL+CYqdooGwwixhgoH9AwgKBBE1DrnCcQ5QCiNig2X4JjwEvVPOVC7OK4XHehfFxgeJTjIULixy+9T288pOPiIPlar6yPMtmN8O1HOFiiFyhEAvLiyIy/FgBbZFvsk7lT8TNyUM4db6bMTKRFI14Vkm6wApI0xUaSEBKQB+1RT9Pnq74qoznaQ3coWLgjEVjyKmHmqNq7TaJOSID8/TT6CmGPDQQJACLQu6jkwztQ3lJzqMyykuFSXDUeskZ5mjOS9MFkj01DdlyqFpoN4ODUDpDYkFxqBx8c4G2LGANVVF7bIrXtWBGLJgw0jRGRVuscOnjspdzLppTgBw7jmq8CBl1Eo7ApZZoqhxOnaCphXDqJKlU93C3x8d5JuS9UW1/AztKK2KKR7DbHakTsXbAyVeFOuhEIBpVbA6eOzF/PKLZEA9Vwqw4X81Xzs+GRUvlfGRatGBeMJiF84siagUzo6WFZD1hLNhpEgZraeGlFXBFmKIV5YpWnC0YYwBntALOQL60XDA55oAG8Tk8e8TyKIPQidMyhLGCd8Y/gp4yTItyDJ9eYulyJH2CpRcWk/ER9iG0gjmUnyBzSC5xwB5DhRUG3q/Z2hVjMXV1d4zlr1E8Y7WGMFbi6kMUgF2sPkkimipB4dU5UQViIAvKosjkRYlXvaPyguhCFS6L5wmaGStNWcMrL0fKF/nyclA+IgZ4t/PuxADbOexutHw9KCwGSsPFQBLVqYYXVlwS9TsGslADqhfCZPd0ogWTo1uD0p3L4wnf4AnPw4QwyFEMRR7DcNLzLv7dkZ7tyHZHel9P3A3pR2yKaOTp4J2/Dd74ip9LHQsOjnieBCdjmKuRkDDDXEU5JOfz+V3se0iExBBthuysSOzpgrYoIrXHPs8tRES7Hzn89NOkUBX0Rfjdo795UU+s+GyxJhGUhtSFZcFbpllaD5QhH45AVQIYAhEoPWQj62pGB0ctO7tTypQ2mLM9DUaWpkFhkfKgL2Xy0hQNUCtOoDGqVjmakXHH8lJBRuMszFVbFEIYV00IJ/Xpsg/JIMc9iHC/0DiAj4VQT0zwqMeUtpUjEWZoHKldHk1ADh5N3XQImlKRQzMmS1MRVD1+d84xmYrrSu+g5lgZPmLW6PGxT7vYUHu8Q8aUqLd+yliV+GQqBI60Wak5fgEBzcLiVxCCAiCeqApM28FC3CO1nYvVdm50beditZ3bqbZ1/9pTLzxZMXqhWET2HSYpuT6kjlUukt3HURlhHCEnf3lMDc0lM0hx+XhmV7GbmMTAQSgc5wMJgyJEB7/qFahwyTDfswcOPDeWkNejeee8PDSOJsP2npCQ9c87rCE3X0ac40EyzNUMxK137DKayec9w1zDNttlOElBWgKnKUi1cKKCNHndA3RNcsirW+abCvB888YnoSD7WKenmULj0dB7Z81QgOpFftsERBwrSCVwGnovBuy2U5OFn9cp6JIhdccuks4YUm/sIu3GxaQOYMXBGTdgJncWfNb7UGnMhf9AhGVJdyxzNZMtjLnjBbEIUceRsFYXW9ArbiEhbMM6G9fPXD7MUhYRFMwyaMnNCznvt9rxgks97Yw12acmYTgPHEhFhGHGR2ZK3Ww4WxjDQeletHQvUroXLt0Llb4YLX0xUvpiuPRFvzTQx52rykLCsZ6h85jeNsBHLzqhKEFdcdwzlrJqsLhExXH3d2zHDzwMPDuqSu5LySgiqonIsbhRo3iDo0pT+fD4sXxiPVtTyoChXBORW6acAjcFme2MMJaX5AKgLiPHgsU5I9Mw7SjUjLCeEFoNvaBNjPCUf+bo0iUUbWomOHG1D8lgOijkhXDrAQcoN1mOWLPhgoUC2CTkWFGeuoa5Glm/XFvDDhx9IT9mZe9XwgaDnCxZyIQJQY+bsMPdl/Jh5WiI9RVOhg8zv0a1GX/IobSI6GGmIbI3PhSEjYYNxSgKU/6LUriUJyQu5ZNo7LGsT2N6Rs5Qk+zwbqGar7iF2RL8m2Bwi1D5hHApX9lBbeWtygazJT8VPXXw9NPsCNocnA0gzQub4td5MWio/rH9qChsdWpEiBhqlCP4Yj5DkEbXmFGz1aktstOoeRHxFIYt/7SQaKQ0aryBMsGGbtQWlhkT+UzT6tRERDIgDmYmYRpPJExiF1ukuJNRXTYynL4Xmr1ZuaLNgQqYzYbGEJRqChgZIUsCtiIqGvwcryLVRWMkric/WQnY31fveChLciwGLEeRzlXhmhfWOMci1NVEWdiFE4peuMKEMTiOT5mrnqk2UOJsZfWZY9xceoITCuCp07Fik+gk9kJQPpKXIUE+x06eZtvJpf1HzwYgyfENfHTDrqIavC0/PXfm4eg4fhiP5ywOKmBxhIVGxvc323DpA5yuGAllKYaImO5DluwYtMxBA9kp3EXhl7gjVLIkB4Z1YkorwZrCOAbGEexR+8EjmmGmFe4wAD36yphrH1qQS9PkJLk8WaR/p0v0ZHlekifHVK29yGDLaGFCJlmTE+TP9IQPmJ8gkEJSE5iJgTuAEG3CzCRrAUVYmMh7iCciDSjSnEnaRHnKb0Gx5DXAH39ytwj5CljeVxrJQNCC3LAFfOLFMSRxgB8JMZJPgniJ3fCJDx3nk2Q4iK0QvZ5xdAdHGKU7s4Fyx0ISwZgNXgzM9zwRiWb3eONa/+YH/Vc+6N/8ff/qdXoomNPKqMlpjjeGhKnpR17w8Q8BqViURgJFhwIOI2qEXEGBOF13IV5+QXQHFWi/xbaLuzS8iDo0vRbR+BO+xAoHe4rekhqBFlGBtOzwsZPzZ0XvJDsE4gt8iFoI00FtRXNMm4SoxdDld9tBLyrDhwfgo4bjcigt0yENlCd5xAmAEGcjws0BADk9CpIE4vigciHcTeBjQlTnqBd6R7vZ1KWzp4+S32cIfSb5405CPO7uSYZpF0Us03nCEkCSJyzCTpzslpUTVspEtdofBd2si4gOFdwGpWIRmQ1w3gTqwTAe100uHjiJrTncMXaOVMaU95FsTdDJcUUvLOhqdA0CDuBtASQhpP4+0WQfQQYmq0MsNIQgIdAdp/loakRwcXrYqF7V/B75HOAj8mZ2YTpAF4eyyUQFmOmhMOS0VJFC+dM5DhbMewAslPh+P9Gsr3MTfiFCmHD3+G6EmxtuVcJBZV1Y28XM1QX+WHGMTwN9KeBT+KPvzKxsuStx2iYJgyTFya4a/srsb4H9LS4+KWOMYHVWMS/6hnA6D/kLGT2MiuPzgEUyNBaeMQQh31iBAxw2WLH+hJ2+UMH+pudAgAPiZItzGtfpVulZ8Qgfqh9c7waWEXapW3TDrbWbQZBAcP1ambusjUMJ0IBMazcl73ZnP8FQ3I6t6OQQfrwiO3SDRHDGHTpFr3nT2k0RbhGw4Q4ZEW4HsMEsIyJ7obA4xlRne6HIfg8h0MkVbOtEDK6KiNCHY2XyTbwZZNQFcnx+GBGffKeUyyF6OSe7qvPxxh16yXD/7gvbL3/R/+5ruBWQXjg8jh5dedD/+urW775Miu9K9iaG47aipplo/AfcneF0mW+QFhVEBBdnOL0Mc+vS1HD0RyjaqRCOdkrcyoBXj1GqytEqcPwVJ4RIHb7VJtwleqFBDTc1A26jzHClIlFqgeHmAmfo4kMefPvNhUUOf8SG2E40D3oNaZsr+KyZeU5E54RoHrypcNbM+ASmFVHGpcRlKVzJ9VA3Hdc2l/EZuAsCVVGaPh1dmhDliWlRlkVpekJIhwkDdT7LbpMgj9CE8WH3mGbgg4rTyixMiCV+XIP6MsKIUslFvCYyMZHe26irxZKaRmWU3qvOTE3lJ0c2VE4YxdVqvrLKjeJqZBQTLL1GbWF1iD3XH/cuz/O0gCCido9nepYcKxuO8pMmfM7nqx86CWIMwnMxSVDseqbdhdaIqG2Py9I0VRjIvU0MJj5G66F50yS3x3VZiPpp8uLzM96Dz8CnBCX9YY9NcXiakqKqxFR2xjUtMJHGOa5YEtIjigBJ4oXkwqhCckKRfKgAdKeh6brHZc3hwsAno9/BOAUBVWYkG6f3NiZmcL6WriTw6vTuax8vAkF2GsH1iAE8uDlOIAsW/Z0Zspx5uWGnKr0b5xfY84Y5EJ4koCU0Q43EaendlMcXifgOBAIAvomLEMsvybwzIdh6k8gBD5JlV9G0QHxpUBL8aaGjb1p4Mbp0CdEUQgm/1uA0B6c1JXcktJxqsaVUWwxV/xyaRdnpPNT7HJpDz47T3+cguch+zqEj48V8vLbAf7Kgicig8zmMnnOHEKdLXkDkKaVwyIChSg4Y0v1NgyLWQvEkClz5xdPJPyuYDbkCakPh5MgRldqCTA9mZJHCfoYvNiJxcGaXc9b6l9VRV22in4bvL8RB2dRVOVmKB5YXPA/S8iLZhhh8AuxHnuMTYGNyjk8ohiK2NOcwm1wZQBzlqALHUnyxhhOJjyrQy7nguR3iTvWAicQySehcrIJ9aJJ4BifyeQHuASBHZhtwV37a6qIsPBuAs07PcXFbTJ3BTROj3xxNianjWt02HbPhonPKEaylREcxnKyDba2RDsXWg2wB12JBcrnLOAtoH03yfGmFgjCe/unyJ7DeQ0YoLIutR22sOB0bn4WjrgSvQL02PKxrgv/qHFzz5amUBWHMX0wvilSZHEdFaYIvVzPJgaTnCiiLVnPwb0EkyLKwV38O8K2Sy8NYMiNSITSQLc3dT/CEz9bSk0ZkjDn1IxKwSdg1KVyTD6QnQNxxHH/qmF2YPLPIXCgQ7ykkFBbRHDIhnSXIFKLoJxQphLworAVtp0FTdKJzisF6JEaPHIEhZeKyhfaFCJea2fWZlkyoIA4ahhSOLc/Da2WwZNKnytLR/P2Kg2H9BBDXtEL5/LpalEp8VrJaSdQEOS/Kk2JhRpRmCgLRMKn2UJwWCyVZLJQmRWmmJKTj6ALeA6YgrCCEphmnYyRMzYyv3dZr6gSWqXbL7oSGAxf0xkACHkU7vOr1PYnkdFzFdpn+EaUjMfjUsKvV03z8y+DND9g5wsGb38Kd/f7Zwf7Vd/v3Xx/6UsKN7Yfv9h/+5+b93z26fGvryvfeUcPrUV3jsALvjNaXd2thCAwM3qWUwQ70iWwLbMFuNwFRyLbAvsOmhbXYbjVqWPjnGBei2tsoY0GU4fPSFHdB3wh2L02DDxT8n+SFvYDjJ2RxErydopSf8tg9cXP8S2L6eUZmm11fxSGBNfx+liYI0TkeLiNHy8hBmfU9yVvRHWg0MwlOWnDQilKBFwrFvDhZAn+sKMmTu6PRz4jAH0WjRpRGjZ1p1IjSqLEbGpHNn212LIc77ffPPnGXoTXQQB/QrPlvUNcEISmux29GE2kGa2VIzXyKpkktxTm5apyyTQvbbi/TFJI1bcUm5+5p3c3FYUKcCuRmiNhN3awpOrm4Iyzmm8KIo3Q8hgTjU/SApG0n254IlYHMim0vXFiMWNWGHCJkY6DtyrKQxINQdNy2OYbStMVoIdi2hkpEwEUEGLi9bESliO+s49QOnQ3lbbEJYb3U/joyvpN/tmnz3oP+j19QWykhptI4qgYXhGKsOqexoZK73+lFLhA7d9bx9hPsOtilJXIg/xS2GyTmuAH31zhlLzz0OP3ZJs88pNMQIhy+byZ4ZYQOerziYHVkTazSRgp+kxPflMqQliTYAEg6Fx7Fd5yLIM5DYFiUypzhnlJDCKgSCidUQxHIkyURBSGLUAqu8p8MQhIDBPRxDT7eucIfboDzDiDMg7MPNDvpxA13eLJtrsBlWNxpD3KahaAI+kShIOKNP4pdCR2N85Rk/6CvZTrkeMBOxTw4f79Ah4WLTvG7HsT0sTdswsG6XGIQNsrcH1AlK+71n17UC6f41vjYuIrv/KlEvRzhTq5FNDm/4fEZIFHu95T+BAA6J5JYC2WRmx9ark3vnCd3++5D7OIlWLXpy6oFNc2NNj1NER/waDgzsZl44eFJDBEggseQgpkZKIzh6RraCO52dnIxj+HDmN44jjyNGb/9NhQ8PDQs1qkrZMXzl4986EpuYkkmK8ZYXpoShESjXqiKmIFv58jSxIW66x8ftCQ4Iar0/BODNKHGQ8BpxhoPUQtt0QkoOa9Q62aVrjBmSa6ICDw5h1DrZZUeSQ3ZF7WLQJqCVCKH8YFQY2gybEFQ2AoVOmUhoyzyTy5ZkpuFsN0xWSoJAomGneHJQDHQq/IKycQwPRKSAQ7Oa/oXK9Nzst0Kn0JPafbCaeRUJrnsMJRMj2OSWwt51KS68InMcIxcKD7uieKtdjiZ6TcudDSTp8GQM5o7RA7Txxi5Ryz8lV41V41Twe3hoAqpwesqRF6ZHfoyB1kg9yDy1o6iqofg5W94whMb2M6k2YPggC8tBm+J4RU2K6CUg10WP3BAsdyOjTN4RWIFj6rcUtfS6AKs1ZcBpK6DN+Y5Efm/z/F3kwBwyMfLPdMBmZxJphla6deZiI8XC4y1rNBat8w3pBd8nRNR3T88VWenp9YDpe6ARF48BUoB2TJpwNjUjGY6pPL7AzGipvVAZfBGZWfo0JBGT4n5Z4KEnYcWECUOLTnZ6NEu5mxvkzO6QSNRlvUV6NUmJ3aDNgeZPV5Y+FKlrXaFce6rJ6A5eCLU6yTvfaDnMr2GLUJ0fibUDJ+OUldAOd4HhNgxyyGFz4UK92KFn2yAwgc1Q/4T/hW+oQcZPfKHqJ5AdFtpAskTKA45yfQOkZtSu5RMbe+sHEFW79JTwP4ZOJra4w707rZ3TBw8iTQg8SjUheCRxHvGqqX5Sx2nkUZ9VoAjxMdRn11Lc7nNqKtZ7F2Ms8fhbTbs1BULH3HbesaQXOJpmHXaiq7Pgb+BvbEGFoBLl0KPoQgSdSCAZ+Lv3xHnBHXMQcLgvQ/ps8qzOYYr3AD6AoaOG2544IlvIxGWeg84TkgCjcgusFCGXc0HGLZ6x3bI7X6euPARRaRsFK+NgZ12h7ppK7V0dCcd56P1YH8SG8rd02qXlFrfpfjsWEPXxTgxomvEcBHLbjdYAQ8idXT5gLxRYMj6xlGKLHRwFo0i8/AznKMmX7ge31oRXmvjqkTS2O2GkDpWwgsRa2vwVF0lNrl3wXN8iyOk+mc0Xq3pdV2rLycywc8RcpQLvPFpaa5IuipU2LnxQFIJleh7rjs1drWFsZ7YUlDYbAzQB3FD6egub05tKHXX9K1y5KpsvCKpWHeVc955OO+kOhzkmHeHdFVkqChZRbRmKY6jrWB6dTD3JmXMrBDaR7I6vBAhhpOL/CiEt4AytwWc8TaArBTXzVVY5zLtLsqSV5mydO0TcpEgktUeAeuhLHmKKcsOuPBg3iHvi4XwgXMO92p3jM8FnBzK1Z6fG+PGECkIX1FCcASoYXIUFi4ZhZ8HweZYHJOL//ogFrUbCf7Itj3dhA8AybZ7oVKgSnTH1O642htTQyqLimZpH4Q1vy9qxeuhFr4ZwwutwI470mJKX+b2eE0x8Mh3PgkAFSfBFQiBLuCEH4w949qaAdecSzYm125kcgtPz86l0ou5JjfzguezWLm19NPpcvpppW1V0mJ6Fn7rcCV+eg5+NsnPFPy80DHhI5VOldNP7y3OVNLrC/XFodHrTJBoIsgPVin34qfGDC5JWhONDpol8ogQYbiojUgipu9xul6cp0bTG3wRaYH4fMnN4DTyY7c61vFDx0+ePpfeTUVnNVfHsZoMz3ayQ2Gl6aQFXkv0HESG1Lx0aWFRCD8lyl2akZ51LMWY25se53jJFcbTszmSAe/aCeyBAH8tG9mYQ92EbpCw8/TjjWvbD98evPchfYh5++Fbg798OHj3+uD3b21/8vzjjeu7ItVB3EyogdNkd4UFXEYJaKxAwpq21jy085Q8aWshRcqQTGGNFY6gT/d/98fBGy9vPvBuDjYks+KBUmWQ3pIDEyBd0836cjpiLk7Gmx6OxTANnA5NAS+UW/OO3wtJUWceg9DZUiORYVn6odAwMT9EbIfhUtw4Y8MMPdmAGHXgi58u397VmJ2o2WE2R0bND3uSSxEuPx82FPgz/3zIiknfaaK+yTYXK+LPj1rHdSHiQnGVrFZNpcfPj6dTc2TaICKIqinVdFOIUL6aAjs+uEINtZwer5s6AWZzadzffnCTrS2R6RbCl5pLj7eByP48nM3Rdsz57w76k5KQkJZnbYAItSwYJMtywepWSOfKK4qdyWYbima4QmpucOfK4M0P/D0fnepUBkdEbGxntpsxutDBdu8Mke+mPa/rmTRtflqIn4wKQhxrCcpiTK2NbJvhteTxmgTD42BX0oItHltyzkc3Kiikwp7nI8uTjAbrQjggkpz80HuCf4HSMAWJD9fx2H0tdMtjxpCsS5fSaWBcONSVy/ybulZaz/6bulZg/wq58CufbbQPtSH8DDyeXj3D3zDXTQefoorD7mjrUS0rj34Xuv/Oj5s/vhpzqxzDTWyofPwzOU7FB0EMf66XwXrhCxnu89KlvDAuV0JRqaPVJZ20JO2/QRwSG+wZcU2Hw2ahV8QZmVnVy+Sl7bBYWQ6JlXrwBO1iTHSo2oo3pestzUpRIbIMQmR590LE504SDrGvTq6ELdfpRbBCSL7Uqf4REScGiBO/R5xIUbWVBHniUyw+iSXoRtIchvTggrWWZv2MmQwvrZOi3lxervBXzwePuz8VfAUQpGQgtVyz2dRxJm02GmmRLxG5tz4cgw8GivAhFi+fnmPhJgf3pgZ/SX+QPsQCuBshE35JGFsgs8Mzy2f7+BjtpZyPdjdWyYQXE/mawIQqzKQl1XTTAlM7ArYNYsLq3g3Gdf7m4vUdYkluvbv1tz+F9w+KXW9lLrCGX0BVdEFyba2dESTXPAaP/RyAy9X4KIoLZD47Hd11Do3aNAQwvoyogkoV3z60NNd5kgcV/KcP3HAjJQ245WQjc0GImoKhChq05RWOcCwB8NzsVVQKHyWI3IkMsCOUu5oX+h9W6Fg3aWmmXk3761CMWB5oSEwaMTHJAnKTdCwQlIGCZUjaE6hYOypYRlzBqhsuyEQjomIly0OqX0ETWf1xfapCjchllVqtUnOwr7n+Y//aVyGkScwYU68CoPjcVrWVBUqnxaSZHdhV1Z8hfyESblwdoUlpng2Qk307zi4f9sIhXVpR9A7mtuCS+6RiEbDEu6YZVseNKTJUYnjV+m81JaNYxr2h3mWYdnhFWsb0Ot/0IeKBCMegavTetyGjFxm60PMHUFKgCCQyRpnYLWyhyglnp4U10pGa3rEzIRk2XM55hllu+dgFl4So8BRekeidohLRLR03k5YopdPkNrzd8MMItRKCCP9wd5RKW3ONw5q7a3UW7oplhuuIlTpMiIRqSKz8biuiBi0/wr6KgvP8FeS2NCdJNwFu88GiLYwPVkIbj5MIrCdqpB+0VUX+vdWjm+hBCclGup/RbBJ99USt9m/OrCL/6sbRrfYveKwkXfoYuYAU/YxOkLOeT8wf9ISoxyD0a2cOYSdQfw6tz7Zw+8loTRS2KnoK/ka2/DVT7SW0EyDT9MI2Ru5RHeLAIsrtKCtwsjss0a5+++7WO2+NFnNPIu5zaXKG0UdWd7UVzMhMogEuHApud0lyYRFJTU797la087vwnyvmh+3cb33Zf+WzPYjGe1b9ZzmhYTYGq5H3O7qvCe3wvWt7/f39wfmz85LjKq4DChPd7dNjhC55P+dEUCJ4f4BmZr29vmdHh+0+l+qQR2QhcSSzQ+VRSyNlRqiFaOAQb8hcI/SM5ua9L7Y+fn/rwc3+1Re8sAj+NtvkUoP3PmT3gtAikXcVGMjgg3v9hy9QW7eHO96loTVsf/Pi4I23ieroefLIpdx5abLgJfoXllO3X/iict8VGCyCe8IhyzuFYrNg4fj0oYySIDuI4VxXDxN3c3ARO89YkSAgCp0FWAgAknF2UiAt5q12uxYJhOc3f3wH7m955bP+jTdy21+9sP3l61u3P4udKzhs2nUcxBdzWkNEVSBkC1W2vmfP8Ln1eONO/6Wr/W9uDF7/avDa3c2Nt/pXrz3euNG/9Un/2tv9W7/v3324ee8BcXlcO3jmCHMEwhE/7ullc3W/abr0Dd62Q+OvwnKY34CFNiiWoqqa0SyX8la3AsbgsjxhdXOyNIOCs8XMLLy3WCzJExMVOPaUpfe1lmVpJjXnsXV6tpZgV560uqm5/js/bn/1df+VD7Z/+KH/0dfbf/t4Nlebm63ZJBSp7RCPjL8DWg96h9s1rKpYJXGqpGc7G/TIkGVBhU77fPwUDh7h9SInvCvaMzjsJoFdHEgHYjPwEZB0V6q3FHvezeQFIs/Ta+kY2uC9Ys9V/D/PnDwhWYrNXenOymRUsmBIcCmYw/30A8b3IbjkwQ+P5B+mDNWL1ves78mE5xihVBucOGEqel3C7RqZ2qbpkt9hOwYJr7bI5dLwXLfZCObE/tPzR08szZ86urRElyOHCCSy+CUB0eeTgaw5xdJyqtPKkjHKNW3FahG51cBg1lYsTURrqK7UW3BQxzCzjmvaID3qNlYxedLZKaO0o7RxFvxYmpFG7HVmyW1hI6CAHfVX29J5BygjERLypPI92gjDHCqj9JGzZ08RIWyTdarjoPUK4l6BjtR1Pn7BjS2Zy0LshezzQKHzEqkG7fN/lVEmXmX43hnWxPPc9TH+jjep+2o4MItcavCUx2fcb5/Rok31OJO0kFo2mDB6eLv/zvub91/a+vw+FVvBLpWwkhppWITewfMaYcnFFjVyNNh/JxXt436XERZQYLhJg/iA/w/+4/Lgjx/Ttgzu33q8cWe2bqp47n/nJNVp5ag4gLunsS3VTaOhNQkrzOYIFIIj17QAYUdw97Ksxxs30nyFg2tvDG7+YfPBt1vv3O3/8PrmvVeDshxD89j/cflKmjNNrAsw/WZzTt3WLHduz2wO5DP8bbltfW7P/wPMgO9M9cUAAA==";
    var appHtmlPromise = null;

    /** Blob 文档里没有可用的相对路径，得把绝对 API 地址注入进去（懒算，兼容 Node 冒烟环境）。 */
    function graphApiUrl() {
      var origin = (typeof location !== "undefined" && location && location.origin) ? String(location.origin) : "";
      return origin + "/api/dsh-brain/graph";
    }

    /** 懒解压：只有第一次打开面板时才把 gzip 解开成 HTML。 */
    function loadAppHtml() {
      if (appHtmlPromise !== null) return appHtmlPromise;
      appHtmlPromise = new Promise(function (resolve, reject) {
        try {
          var bin = atob(APP_GZIP_B64);
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          if (typeof DecompressionStream === "undefined") {
            reject(new Error("当前浏览器不支持 DecompressionStream"));
            return;
          }
          var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
          new Response(stream).text().then(function (html) {
            resolve(html.replace(
              "/*__BRAIN_API_BOOTSTRAP__*/",
              "window.__BRAIN_API__ = " + JSON.stringify(graphApiUrl()) + ";",
            ));
          }, reject);
        } catch (error) {
          reject(error);
        }
      });
      return appHtmlPromise;
    }

    var NS = "dsh-brain-viewer";
    var MESSAGES = {
      zh: {
        "app.name": "AI 大脑",
        "panel.title": "🧠 AI 大脑 · 关系图谱",
        "panel.hint": "关系图谱：悬停高亮、拖拽回弹、神经放电",
        "panel.close": "关闭",
        "panel.popout": "新窗口打开",
        "panel.loading": "正在解压图谱…",
        "panel.error": "图谱加载失败，刷新页面重试",
      },
      en: {
        "app.name": "AI Brain",
        "panel.title": "🧠 AI Brain · Relationship Graph",
        "panel.hint": "Relationship graph: hover, drag, synapse pulses",
        "panel.close": "Close",
        "panel.popout": "Open in new window",
        "panel.loading": "Unpacking graph…",
        "panel.error": "Failed to load the graph. Refresh and retry.",
      },
    };

    function translateFactory(locale) {
      if (locale !== undefined && locale !== null && typeof locale.bind === "function") {
        try {
          return locale.bind(NS);
        } catch (error) {
          /* fallback below */
        }
      }
      return function (key) {
        return (MESSAGES.zh[key] !== undefined ? MESSAGES.zh[key] : key);
      };
    }

    /* ---------------- 开合状态 ---------------- */
    var store = { open: false };
    var listeners = new Set();
    var getOpen = function () { return store.open; };
    var subscribe = function (cb) {
      listeners.add(cb);
      return function () { listeners.delete(cb); };
    };
    var setOpen = function (v) {
      if (store.open !== v) {
        store.open = v;
        listeners.forEach(function (cb) { cb(); });
      }
    };
    var useOpen = function () { return react.useSyncExternalStore(subscribe, getOpen); };

    /* ---------------- 全屏面板 ---------------- */
    function BrainPanel(props) {
      var t = props.t;
      var open = useOpen();
      var state = react.useState({ status: "idle", url: null });
      var view = state[0];
      var setView = state[1];

      react.useEffect(function () {
        if (!open || view.status !== "idle") return;
        setView({ status: "loading", url: null });
        loadAppHtml().then(
          function (html) {
            var blob = new Blob([html], { type: "text/html;charset=utf-8" });
            setView({ status: "ready", url: URL.createObjectURL(blob) });
          },
          function () {
            setView({ status: "error", url: null });
          }
        );
      }, [open, view.status]);

      react.useEffect(function () {
        if (!open) return undefined;
        var onKey = function (ev) {
          if (ev.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [open]);

      if (!open) return null;

      var header = react.createElement(
        "div",
        {
          style: {
            display: "flex", alignItems: "center", gap: "12px",
            padding: "10px 16px", background: "#111827",
            borderBottom: "1px solid #222a3a", flex: "none",
          },
        },
        react.createElement("span", { style: { fontSize: "15px", fontWeight: 600, color: "#e6e0d4" } }, t("panel.title")),
        react.createElement("span", { style: { fontSize: "12px", color: "#8b93a7", flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t("panel.hint")),
        view.url !== null
          ? react.createElement("a", {
              href: view.url, target: "_blank", rel: "noreferrer",
              style: { fontSize: "12px", color: "#93c5fd", textDecoration: "none", padding: "4px 8px" },
            }, t("panel.popout"))
          : null,
        react.createElement("button", {
          onClick: function () { setOpen(false); },
          title: t("panel.close"),
          style: {
            background: "transparent", border: "none", color: "#8f8a97",
            fontSize: "16px", cursor: "pointer", padding: "4px 10px", borderRadius: "8px",
          },
        }, "✕")
      );

      var body;
      if (view.status === "ready") {
        body = react.createElement("iframe", {
          title: "dsh-brain",
          src: view.url,
          style: { flex: "1", border: "none", width: "100%", background: "#0a101d" },
        });
      } else {
        body = react.createElement(
          "div",
          {
            style: {
              flex: "1", display: "flex", alignItems: "center", justifyContent: "center",
              color: view.status === "error" ? "#f87171" : "#8b93a7", fontSize: "13px",
            },
          },
          view.status === "error" ? t("panel.error") : t("panel.loading")
        );
      }

      return react.createElement(
        "div",
        {
          role: "dialog",
          "aria-label": t("panel.title"),
          onClick: function (ev) { if (ev.target === ev.currentTarget) setOpen(false); },
          style: {
            position: "fixed", inset: "0", zIndex: 99999, display: "flex",
            alignItems: "center", justifyContent: "center",
            background: "rgba(8,11,20,.62)",
          },
        },
        react.createElement(
          "div",
          {
            style: {
              width: "min(1400px, 96vw)", height: "90vh", background: "#0a101d",
              borderRadius: "16px", display: "flex", flexDirection: "column",
              overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,.55)",
              border: "1px solid #222a3a",
            },
          },
          header,
          body
        )
      );
    }

    /* ---------------- 左侧栏底部按钮 ---------------- */
    function BrainToggle(props) {
      var t = props.t;
      var open = useOpen();
      var showLabel = props.wide !== false;
      return react.createElement(
        "button",
        {
          onClick: function () { setOpen(!open); },
          title: t("panel.hint"),
          style: {
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            gap: "6px", cursor: "pointer", border: "1px solid #2e384b",
            borderRadius: "999px", background: open ? "#7c2d12" : "transparent",
            color: open ? "#fff" : "#b8b2a6", padding: "6px 10px", fontSize: "13px",
            maxWidth: "100%", overflow: "hidden",
          },
        },
        react.createElement("span", { style: { fontSize: "15px", lineHeight: 1 } }, "🧠"),
        showLabel
          ? react.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t("app.name"))
          : null
      );
    }

    /* ---------------- 插件入口 ---------------- */
    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined || slots === null) return;
      var locale = ctx.get("locale");
      var t = translateFactory(locale);

      if (locale !== undefined && locale !== null && typeof locale.register === "function") {
        ctx.effect(function () {
          return locale.register(NS, MESSAGES);
        }, "dsh-brain: locale dictionaries");
      }

      slots.inject("shell.overlay", function () {
        return slots.register(
          { name: "shell.overlay", id: "dsh-brain.panel", order: 20, locale: NS },
          function (props) {
            return react.createElement(BrainPanel, { t: (props && props.t) || t });
          }
        );
      });

      slots.inject("sidebar.footer.action", function () {
        return slots.register(
          { name: "sidebar.footer.action", id: "dsh-brain.toggle", order: 10, label: function () { return t("app.name"); }, locale: NS },
          function (props) {
            return react.createElement(BrainToggle, { t: (props && props.t) || t, wide: props && props.wide });
          }
        );
      });
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale"];
    return module.exports;
  },
});
